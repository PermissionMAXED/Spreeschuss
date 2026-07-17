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
  Vector2,
} from "three";
import type { GoobyReaction } from "../../core/contracts/gooby";
import { HOME_ZONE_IDS, type HomeZoneId } from "../../core/contracts/scenes";
import { ProceduralGooby } from "../../gooby";
import { createProceduralAsset } from "../../render/proc";
import type { GameRenderer, ResourceTracker } from "../../render/renderer";

export const HOME_ZONE_STUBS: Readonly<Record<HomeZoneId, { readonly title: string; readonly ready: boolean }>> = {
  "living-room": { title: "Living Room", ready: true },
  kitchen: { title: "Sunny Kitchen", ready: false },
  bathroom: { title: "Bubble Bathroom", ready: false },
  bedroom: { title: "Cozy Bedroom", ready: false },
  garden: { title: "Carrot Garden", ready: false },
};

if (Object.keys(HOME_ZONE_STUBS).length !== HOME_ZONE_IDS.length) {
  throw new Error("Every home zone requires a registry entry");
}

export class LivingRoom {
  readonly gooby = new ProceduralGooby();
  private readonly root = new Group();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private elapsed = 0;

  constructor(
    private readonly gameRenderer: GameRenderer,
    tracker: ResourceTracker,
  ) {
    const { scene, camera } = gameRenderer;
    scene.background = new Color(0xf7d3aa);
    scene.fog = null;
    camera.position.set(0, 3.2, 10.7);
    camera.lookAt(0, 2.1, 0);

    const floor = new Mesh(new PlaneGeometry(15, 12), new MeshStandardMaterial({ color: 0xd49b69, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const backWall = new Mesh(new BoxGeometry(14, 7.2, 0.24), new MeshStandardMaterial({ color: 0xf4cba5 }));
    backWall.position.set(0, 3.5, -3.1);
    backWall.receiveShadow = true;
    const sideWall = new Mesh(new BoxGeometry(0.24, 7.2, 8), new MeshStandardMaterial({ color: 0xefbea0 }));
    sideWall.position.set(-6.8, 3.5, 0);

    const rug = createProceduralAsset("furniture.rug");
    rug.position.set(0, 0.04, 0.4);
    rug.scale.set(1.4, 1, 1.2);
    const sofa = createProceduralAsset("furniture.sofa");
    sofa.position.set(-3.5, 0, -1.95);
    sofa.rotation.y = 0.16;
    const table = createProceduralAsset("furniture.coffee-table");
    table.position.set(2.85, 0, 0.6);
    table.scale.setScalar(0.75);
    const lamp = createProceduralAsset("furniture.lamp");
    lamp.position.set(4.8, 0, -2.1);
    const shelf = createProceduralAsset("furniture.bookshelf");
    shelf.position.set(4.55, 0, -2.8);
    shelf.scale.setScalar(0.8);

    const windowFrame = new Mesh(
      new BoxGeometry(2.8, 2.1, 0.12),
      new MeshStandardMaterial({ color: 0xfff1cf }),
    );
    windowFrame.position.set(0.8, 4.45, -2.92);
    const windowGlass = new Mesh(
      new PlaneGeometry(2.36, 1.67),
      new MeshStandardMaterial({ color: 0x9dd6df, roughness: 0.25 }),
    );
    windowGlass.position.set(0.8, 4.45, -2.85);

    const planter = new Mesh(new CylinderGeometry(0.45, 0.34, 0.6, 12), new MeshStandardMaterial({ color: 0xc97b59 }));
    planter.position.set(-5.2, 0.3, -2.5);
    const plant = createProceduralAsset("city.tree");
    plant.position.set(-5.2, 0.52, -2.5);
    plant.scale.setScalar(0.52);

    const ambient = new AmbientLight(0xffe7c7, 2.4);
    const sun = new DirectionalLight(0xfff2d2, 3.4);
    sun.position.set(-3, 7, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -2;

    this.gooby.root.position.set(0, 0.08, 0.3);
    this.gooby.root.scale.setScalar(1.08);
    this.root.add(
      floor,
      backWall,
      sideWall,
      rug,
      sofa,
      table,
      lamp,
      shelf,
      windowFrame,
      windowGlass,
      planter,
      plant,
      this.gooby.root,
    );
    scene.add(this.root, ambient, sun);
    tracker.trackTree(this.root);
    tracker.track(ambient);
    tracker.track(sun);
  }

  update(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.gooby.update(deltaSeconds, this.elapsed);
  }

  hitGooby(clientX: number, clientY: number): boolean {
    const rect = this.gameRenderer.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.gameRenderer.camera);
    return this.raycaster.intersectObject(this.gooby.root, true).length > 0;
  }

  react(reaction: GoobyReaction): void {
    this.gooby.react(reaction);
  }

  setSleeping(sleeping: boolean): void {
    this.gooby.setSleeping(sleeping);
  }
}
