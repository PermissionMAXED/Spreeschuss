import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Raycaster,
  SphereGeometry,
  Vector2,
} from "three";
import type { GameScene, SceneContext, ShopId } from "../../core/contracts/scenes";
import type { SaveState } from "../../core/contracts/save";
import { ProceduralGooby } from "../../gooby";
import type { GameRenderer } from "../../render/renderer";
import {
  SHOP_CATALOGS,
  type CatalogItem,
  type CosmeticSlot,
} from "../../data/catalog";
import { purchaseCatalogItem, type PurchaseRequest, type PurchaseResult } from "./economy";
import {
  consumeCityShopArrival,
  type CityShopArrival,
  type ShopVisitHistory,
  type TownExitHandoff,
} from "./routes";
import { CosmeticTryOnSession, type EquippedCosmetics } from "./try-on";
import {
  createCatalogItemModel,
  createCosmeticModel,
  createDisplayFixture,
  disposeObjectTree,
  ProceduralShopkeeper,
} from "./visuals";

interface ShopTheme {
  readonly title: string;
  readonly subtitle: string;
  readonly wall: number;
  readonly floor: number;
  readonly fixture: number;
  readonly sky: number;
}

const SHOP_THEMES: Readonly<Record<ShopId, ShopTheme>> = {
  "carrot-market": {
    title: "Grocery",
    subtitle: "Fresh bites for happy bellies",
    wall: 0xffd99a,
    floor: 0xc78d5d,
    fixture: 0x9b6847,
    sky: 0xf7c870,
  },
  "cloud-boutique": {
    title: "Furniture & Decor",
    subtitle: "Cozy pieces for every room",
    wall: 0xcbd7b5,
    floor: 0xa47d60,
    fixture: 0x80674f,
    sky: 0xaec4a1,
  },
  "fluff-salon": {
    title: "Boutique",
    subtitle: "Try a look, keep what feels you",
    wall: 0xe2c7df,
    floor: 0xb494aa,
    fixture: 0x8a7291,
    sky: 0xc8a6ce,
  },
};

export const SHOP_CONTROL_LAYOUT = Object.freeze({
  town: Object.freeze({
    insetBlockStart: "max(122px, calc(env(safe-area-inset-top) + 108px))",
    insetInlineEnd: "12px",
    insetBlockEnd: "auto",
    avoidsHudControl: "Places",
  }),
} as const);

export interface ShopSceneDependencies {
  readonly renderer: GameRenderer;
  readonly mount: HTMLElement;
  readonly getState: () => SaveState;
  readonly setState: (state: SaveState) => void | Promise<void>;
  readonly visitHistory: ShopVisitHistory;
  readonly purchase?: (request: PurchaseRequest) => PurchaseResult | Promise<PurchaseResult>;
  readonly equippedCosmetics?: EquippedCosmetics;
  readonly onTryOnChanged?: (equipped: EquippedCosmetics) => void;
  readonly onTownExit: (handoff: TownExitHandoff) => void | Promise<void>;
  readonly onMessage?: (message: string) => void;
}

function shopStyles(): string {
  return `
    .shop-layer{position:absolute;inset:0;z-index:8;pointer-events:none;color:#51413e;font-family:inherit}
    .shop-layer button{pointer-events:auto;border:0;font:inherit;color:inherit}
    .shop-heading{position:absolute;top:max(122px,calc(env(safe-area-inset-top) + 108px));left:12px;
      max-width:58%;padding:8px 12px;border-radius:16px;background:#fff4e9e8;box-shadow:0 7px 20px #51342528}
    .shop-heading b,.shop-heading small{display:block}.shop-heading b{font-size:15px}.shop-heading small{font-size:9px;margin-top:2px}
    .shop-town{position:absolute;top:max(122px,calc(env(safe-area-inset-top) + 108px));right:12px;
      padding:10px 14px;border-radius:999px;background:#fff8e9;box-shadow:0 7px 20px #51342532;font-weight:850}
    .shop-walk-pad{position:absolute;left:16px;bottom:max(158px,calc(env(safe-area-inset-bottom) + 145px));
      width:94px;height:94px;border-radius:50%;pointer-events:auto;touch-action:none;background:#fff9e555;
      border:2px solid #fff9;box-shadow:inset 0 0 0 25px #5c4b4530}
    .shop-walk-knob{position:absolute;left:50%;top:50%;width:32px;height:32px;border-radius:50%;
      transform:translate(-50%,-50%);background:#fff0d9dd;box-shadow:0 3px 12px #49352e44}
    .shop-inspect{position:absolute;right:14px;bottom:max(146px,calc(env(safe-area-inset-bottom) + 133px));
      left:124px;padding:12px;border-radius:18px;pointer-events:auto;background:#fff8eef2;box-shadow:0 12px 35px #5134253d}
    .shop-inspect[hidden]{display:none}.shop-inspect h2{margin:0;font-size:16px}.shop-inspect p{margin:5px 0;font-size:10px;line-height:1.35}
    .shop-meta{display:flex;gap:5px;flex-wrap:wrap}.shop-meta span{padding:3px 6px;border-radius:99px;background:#ead8c6;font-size:8px;font-weight:800}
    .shop-actions{display:flex;gap:6px;margin-top:8px}.shop-actions button{flex:1;padding:8px 5px;border-radius:10px;background:#6f5a8d;color:white;font-size:10px;font-weight:850}
    .shop-actions .shop-close,.shop-actions .shop-revert{background:#decdbd;color:#594943}
    .shop-greeting{position:absolute;top:205px;right:18px;left:18px;padding:8px 12px;border-radius:13px;
      opacity:0;transform:translateY(-5px);background:#4e403be8;color:#fff;font-size:10px;text-align:center;transition:180ms}
    .shop-greeting.show{opacity:1;transform:none}
    @media(max-height:690px){.shop-heading,.shop-town{top:max(106px,calc(env(safe-area-inset-top) + 92px))}
      .shop-greeting{top:174px}.shop-walk-pad{bottom:132px}.shop-inspect{bottom:126px}}
  `;
}

export class WalkableShopScene implements GameScene {
  readonly id: `shop:${ShopId}`;
  private readonly root = new Group();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly displayRoots: Group[] = [];
  private readonly keys = new Set<string>();
  private readonly shopkeeper: ProceduralShopkeeper;
  private readonly gooby = new ProceduralGooby();
  private readonly tryOnSession: CosmeticTryOnSession | null;
  private readonly tryOnModels = new Group();
  private readonly arrival: CityShopArrival;
  private overlay: HTMLElement | null = null;
  private style: HTMLStyleElement | null = null;
  private selected: CatalogItem | null = null;
  private preview: Group | null = null;
  private elapsed = 0;
  private walkX = 0;
  private walkY = 0;
  private requestCounter = 0;
  private pointerStart: Readonly<{ x: number; y: number }> | null = null;
  private entered = false;
  private disposed = false;
  private leaving = false;

  constructor(
    readonly shopId: ShopId,
    arrival: CityShopArrival,
    private readonly dependencies: ShopSceneDependencies,
  ) {
    this.id = `shop:${shopId}`;
    this.arrival = arrival;
    this.shopkeeper = new ProceduralShopkeeper(shopId);
    this.tryOnSession =
      shopId === "fluff-salon"
        ? new CosmeticTryOnSession(dependencies.equippedCosmetics, (equipped) => {
            this.renderTryOn(equipped);
            dependencies.onTryOnChanged?.(equipped);
          })
        : null;
  }

  enter(context: SceneContext): void {
    if (this.entered) throw new Error("A shop scene can only be entered once");
    consumeCityShopArrival(this.arrival, this.shopId);
    this.entered = true;
    this.buildInterior();
    this.buildOverlay();
    this.resize(context);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    const canvas = this.dependencies.renderer.renderer.domElement;
    canvas.addEventListener("pointerdown", this.onCanvasPointerDown);
    canvas.addEventListener("pointerup", this.onCanvasPointerUp);
    this.showMessage(this.shopkeeper.greet());
  }

  update(deltaSeconds: number): void {
    if (!this.entered || this.disposed) return;
    this.elapsed += deltaSeconds;
    this.gooby.update(deltaSeconds, this.elapsed);
    this.shopkeeper.update(deltaSeconds, this.elapsed);
    this.updateWalking(deltaSeconds);
    if (this.preview) {
      const camera = this.dependencies.renderer.camera;
      this.preview.position.set(camera.position.x, camera.position.y - 0.16, camera.position.z - 3.05);
      this.preview.rotation.y += deltaSeconds * 1.25;
    }
    for (const [index, display] of this.displayRoots.entries()) {
      display.rotation.y = Math.sin(this.elapsed * 0.72 + index) * 0.08;
    }
  }

  resize(context: SceneContext): void {
    const camera = this.dependencies.renderer.camera;
    camera.aspect = context.viewport.width / Math.max(1, context.viewport.height);
    camera.fov = camera.aspect < 0.75 ? 48 : 42;
    camera.updateProjectionMatrix();
    this.dependencies.renderer.resize();
  }

  exit(): void {
    this.tryOnSession?.revert();
    this.keys.clear();
    this.walkX = 0;
    this.walkY = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    const canvas = this.dependencies.renderer.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onCanvasPointerDown);
    canvas.removeEventListener("pointerup", this.onCanvasPointerUp);
    this.tryOnSession?.dispose();
    this.gooby.dispose();
    this.clearPreview();
    disposeObjectTree(this.root);
    this.overlay?.remove();
    this.style?.remove();
    this.overlay = null;
    this.style = null;
    this.displayRoots.length = 0;
  }

  inspectItem(itemId: string): CatalogItem | null {
    const item = SHOP_CATALOGS[this.shopId].find((entry) => entry.id === itemId) ?? null;
    if (!item) return null;
    this.selected = item;
    this.clearPreview();
    this.preview = createCatalogItemModel(item);
    this.preview.scale.setScalar(item.kind === "furniture" ? 0.34 : 0.44);
    this.dependencies.renderer.scene.add(this.preview);
    this.refreshInspectPanel();
    return item;
  }

  private buildInterior(): void {
    const { scene, camera } = this.dependencies.renderer;
    const theme = SHOP_THEMES[this.shopId];
    scene.background = new Color(theme.sky);
    scene.fog = null;
    camera.position.set(0, 2.05, 7.2);
    camera.rotation.set(0, 0, 0);
    camera.lookAt(0, 1.5, -4);

    const floor = new Mesh(
      new PlaneGeometry(9, 28),
      new MeshStandardMaterial({ color: theme.floor, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -5;
    floor.receiveShadow = true;
    const leftWall = new Mesh(
      new BoxGeometry(0.24, 6, 28),
      new MeshStandardMaterial({ color: theme.wall, roughness: 0.86 }),
    );
    leftWall.position.set(-4.35, 3, -5);
    const rightWall = leftWall.clone();
    rightWall.position.x = 4.35;
    const backWall = new Mesh(
      new BoxGeometry(9, 6, 0.24),
      new MeshStandardMaterial({ color: theme.wall, roughness: 0.86 }),
    );
    backWall.position.set(0, 3, -18.8);
    this.root.add(floor, leftWall, rightWall, backWall);
    this.addThemeDecor(theme);

    const catalog = SHOP_CATALOGS[this.shopId];
    catalog.forEach((item, index) => {
      const row = Math.floor(index / 2);
      const side = index % 2 === 0 ? -1 : 1;
      const display = new Group();
      display.position.set(side * 3.18, 0.82, 4.2 - row * 1.72);
      display.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const fixture = createDisplayFixture(item.display.fixture, theme.fixture);
      const model = createCatalogItemModel(item);
      model.position.y = item.display.fixture === "pedestal" ? 0.12 : 0.25;
      model.scale.setScalar(item.kind === "furniture" ? 0.58 : 0.72);
      display.userData.catalogItemId = item.id;
      display.add(fixture, model);
      this.displayRoots.push(display);
      this.root.add(display);
    });

    this.shopkeeper.root.position.set(-1, 0, 0);
    this.shopkeeper.root.rotation.y = 0.25;
    this.root.add(this.shopkeeper.root);
    if (this.shopId === "fluff-salon") {
      const mannequin = this.createTryOnMannequin();
      mannequin.position.set(1, 0, 0);
      mannequin.add(this.tryOnModels);
      this.root.add(mannequin);
      this.renderTryOn(this.tryOnSession?.equipped ?? {});
    }

    const ambient = new AmbientLight(0xfff2dd, 2.25);
    const sun = new DirectionalLight(0xffeed1, 3.1);
    sun.position.set(-3, 8, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.root.add(ambient, sun);
    scene.add(this.root);
  }

  private addThemeDecor(theme: ShopTheme): void {
    if (this.shopId === "carrot-market") {
      for (let index = 0; index < 7; index += 1) {
        const basket = new Mesh(
          new CylinderGeometry(0.48, 0.38, 0.32, 14),
          new MeshStandardMaterial({ color: 0xa96f47, roughness: 0.9 }),
        );
        basket.position.set(index % 2 === 0 ? -4.05 : 4.05, 2.7, 3.5 - index * 2.5);
        this.root.add(basket);
      }
    } else if (this.shopId === "cloud-boutique") {
      for (let index = 0; index < 6; index += 1) {
        const beam = new Mesh(
          new BoxGeometry(8.4, 0.14, 0.18),
          new MeshStandardMaterial({ color: 0x7d654f, roughness: 0.82 }),
        );
        beam.position.set(0, 4.9, 4 - index * 4);
        this.root.add(beam);
      }
    } else {
      for (let index = 0; index < 8; index += 1) {
        const globe = new Mesh(
          new SphereGeometry(0.13, 10, 8),
          new MeshStandardMaterial({ color: index % 2 === 0 ? 0xffe1bc : 0xe9c8ff, roughness: 0.35 }),
        );
        globe.position.set(index % 2 === 0 ? -4.02 : 4.02, 3.1, 4 - index * 2.15);
        this.root.add(globe);
      }
    }
    const welcome = new Mesh(
      new BoxGeometry(3.6, 0.72, 0.16),
      new MeshStandardMaterial({ color: theme.fixture, roughness: 0.78 }),
    );
    welcome.position.set(0, 4.5, -18.55);
    this.root.add(welcome);
  }

  private createTryOnMannequin(): Group {
    this.gooby.root.name = "Live Gooby cosmetic try-on";
    this.gooby.root.scale.setScalar(0.62);
    this.tryOnModels.position.set(0, 0, 0.56);
    this.gooby.root.add(this.tryOnModels);
    return this.gooby.root;
  }

  private renderTryOn(equipped: EquippedCosmetics): void {
    for (const child of [...this.tryOnModels.children]) disposeObjectTree(child);
    const positions: Readonly<Record<CosmeticSlot, readonly [number, number, number]>> = {
      head: [0, 2.25, 0],
      ears: [0, 2.5, 0],
      neck: [0, 1.5, 0],
      back: [0, 1.12, -0.56],
    };
    for (const itemId of Object.values(equipped)) {
      if (!itemId) continue;
      const item = SHOP_CATALOGS["fluff-salon"].find((candidate) => candidate.id === itemId);
      if (!item || item.kind !== "cosmetic") continue;
      const model = createCosmeticModel(item);
      model.position.set(...positions[item.slot]);
      model.scale.setScalar(item.slot === "back" ? 0.68 : 0.58);
      this.tryOnModels.add(model);
    }
  }

  private buildOverlay(): void {
    this.style = document.createElement("style");
    this.style.dataset.shopStyles = this.shopId;
    this.style.textContent = shopStyles();
    document.head.append(this.style);
    const theme = SHOP_THEMES[this.shopId];
    this.overlay = document.createElement("section");
    this.overlay.className = "shop-layer";
    this.overlay.dataset.shop = this.shopId;
    this.overlay.innerHTML = `
      <header class="shop-heading"><b>${theme.title}</b><small>${theme.subtitle}</small></header>
      <button class="shop-town" data-shop-action="town" aria-label="Return to Town">Town</button>
      <div class="shop-greeting" role="status" aria-live="polite"></div>
      <div class="shop-walk-pad" aria-label="Walk around shop" role="application">
        <i class="shop-walk-knob"></i>
      </div>
      <article class="shop-inspect" aria-live="polite" hidden>
        <h2></h2><div class="shop-meta"></div><p></p>
        <div class="shop-actions">
          <button data-shop-action="buy">Buy</button>
          ${this.shopId === "fluff-salon" ? '<button data-shop-action="try">Try on</button><button class="shop-revert" data-shop-action="revert">Revert</button>' : ""}
          <button class="shop-close" data-shop-action="close">Close</button>
        </div>
      </article>
    `;
    this.dependencies.mount.append(this.overlay);
    this.overlay.querySelector('[data-shop-action="town"]')?.addEventListener("click", () => {
      void this.leaveForTown();
    });
    this.overlay.querySelector('[data-shop-action="buy"]')?.addEventListener("click", () => {
      void this.purchaseSelected();
    });
    this.overlay.querySelector('[data-shop-action="try"]')?.addEventListener("click", () => this.trySelected());
    this.overlay.querySelector('[data-shop-action="revert"]')?.addEventListener("click", () => {
      this.tryOnSession?.revert();
      this.showMessage("Your original look is back.");
    });
    this.overlay.querySelector('[data-shop-action="close"]')?.addEventListener("click", () => this.closeInspect());
    const pad = this.overlay.querySelector<HTMLElement>(".shop-walk-pad");
    pad?.addEventListener("pointerdown", this.onPadPointer);
    pad?.addEventListener("pointermove", this.onPadPointer);
    pad?.addEventListener("pointerup", this.onPadEnd);
    pad?.addEventListener("pointercancel", this.onPadEnd);
  }

  private refreshInspectPanel(): void {
    const panel = this.overlay?.querySelector<HTMLElement>(".shop-inspect");
    if (!panel || !this.selected) return;
    panel.hidden = false;
    const item = this.selected;
    const heading = panel.querySelector("h2");
    const description = panel.querySelector("p");
    const meta = panel.querySelector<HTMLElement>(".shop-meta");
    const buy = panel.querySelector<HTMLButtonElement>('[data-shop-action="buy"]');
    if (heading) heading.textContent = item.name;
    if (description) description.textContent = item.description;
    if (meta) {
      const details = [`${item.price} coins`, item.rarity, `level ${item.levelRequired}`];
      if (item.kind === "food") details.push(`hunger +${item.hunger}`, `XP +${item.xp}`);
      if (item.kind === "furniture") details.push(item.zones.join(" · "));
      if (item.kind === "cosmetic") details.push(item.slot);
      meta.replaceChildren(...details.map((detail) => {
        const chip = document.createElement("span");
        chip.textContent = detail;
        return chip;
      }));
    }
    if (buy) {
      const state = this.dependencies.getState();
      const owned = !item.stackable && (state.inventory[item.id] ?? 0) > 0;
      buy.textContent = owned ? "Owned" : `Buy · ${item.price}`;
      buy.disabled = owned;
    }
  }

  private async purchaseSelected(): Promise<void> {
    const item = this.selected;
    if (!item) return;
    this.requestCounter += 1;
    const fallbackId = `${this.shopId.replaceAll("-", "")}-${this.requestCounter.toString().padStart(8, "0")}`;
    const request: PurchaseRequest = {
      itemId: item.id,
      requestId: globalThis.crypto?.randomUUID?.() ?? fallbackId,
    };
    const purchase = this.dependencies.purchase ?? ((value: PurchaseRequest) =>
      purchaseCatalogItem(this.dependencies.getState(), value));
    const result = await purchase(request);
    if (result.status === "purchased") await this.dependencies.setState(result.state);
    this.showMessage(result.message);
    this.refreshInspectPanel();
  }

  private trySelected(): void {
    if (!this.selected) return;
    const result = this.tryOnSession?.tryOn(this.selected.id);
    if (result?.status === "previewing") this.showMessage(`${result.item.name} is on—looking cozy!`);
  }

  private closeInspect(): void {
    this.selected = null;
    const panel = this.overlay?.querySelector<HTMLElement>(".shop-inspect");
    if (panel) panel.hidden = true;
    this.clearPreview();
  }

  private clearPreview(): void {
    if (!this.preview) return;
    disposeObjectTree(this.preview);
    this.preview = null;
  }

  private async leaveForTown(): Promise<void> {
    if (this.leaving) return;
    this.leaving = true;
    this.tryOnSession?.revert();
    const handoff = this.dependencies.visitHistory.leaveForTown(this.shopId);
    try {
      await this.dependencies.onTownExit(handoff);
    } catch (error) {
      this.leaving = false;
      throw error;
    }
  }

  private showMessage(message: string): void {
    this.dependencies.onMessage?.(message);
    const greeting = this.overlay?.querySelector<HTMLElement>(".shop-greeting");
    if (!greeting) return;
    greeting.textContent = message;
    greeting.classList.remove("show");
    requestAnimationFrame(() => greeting.classList.add("show"));
  }

  private updateWalking(deltaSeconds: number): void {
    const keyboardX = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const keyboardY = Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) -
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"));
    const x = Math.max(-1, Math.min(1, keyboardX + this.walkX));
    const y = Math.max(-1, Math.min(1, keyboardY + this.walkY));
    const camera = this.dependencies.renderer.camera;
    camera.position.x = Math.max(-1.45, Math.min(1.45, camera.position.x + x * deltaSeconds * 2.6));
    camera.position.z = Math.max(-15.5, Math.min(7.2, camera.position.z + y * deltaSeconds * 3.25));
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onCanvasPointerDown = (event: PointerEvent): void => {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };

  private readonly onCanvasPointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
    const canvas = this.dependencies.renderer.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.dependencies.renderer.camera);
    const intersections = this.raycaster.intersectObjects(this.displayRoots, true);
    for (const intersection of intersections) {
      let target = intersection.object;
      while (target && typeof target.userData.catalogItemId !== "string") target = target.parent as typeof target;
      if (typeof target?.userData.catalogItemId === "string") {
        this.inspectItem(target.userData.catalogItemId);
        break;
      }
    }
  };

  private readonly onPadPointer = (event: PointerEvent): void => {
    const pad = event.currentTarget as HTMLElement;
    if (event.type === "pointerdown") pad.setPointerCapture(event.pointerId);
    const rect = pad.getBoundingClientRect();
    this.walkX = Math.max(-1, Math.min(1, (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.36)));
    this.walkY = Math.max(-1, Math.min(1, (event.clientY - (rect.top + rect.height / 2)) / (rect.height * 0.36)));
    const knob = pad.querySelector<HTMLElement>(".shop-walk-knob");
    if (knob) knob.style.transform = `translate(calc(-50% + ${this.walkX * 25}px),calc(-50% + ${this.walkY * 25}px))`;
  };

  private readonly onPadEnd = (event: PointerEvent): void => {
    this.walkX = 0;
    this.walkY = 0;
    const pad = event.currentTarget as HTMLElement;
    const knob = pad.querySelector<HTMLElement>(".shop-walk-knob");
    if (knob) knob.style.transform = "translate(-50%,-50%)";
  };
}
