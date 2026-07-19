/**
 * Gooby Cake Atelier — pure deterministic rules core.
 *
 * Everything player-visible in the atelier (customer orders, the bake
 * stop-needle, layer stacking, held-swipe frosting coverage, decoration
 * placement, quality/speed/combo scoring, and the coin/XP settlement) lives
 * here as plain data plus pure transitions. The module has zero DOM or clock
 * dependencies — time arrives as injected step deltas and randomness through
 * the shared `RandomSource` contract — so the whole three-customer order
 * flow replays bit-identically in node-based tests.
 *
 * Only erasable TypeScript syntax is used so the node specialist runner can
 * execute this file directly with `--experimental-strip-types`.
 */
import type { MinigamePayout } from "../../core/contracts/minigame";
import type { RandomSource } from "../../core/contracts/rng";

/* ------------------------------------------------------------------ */
/* Catalog: flavors, frostings, and original decorations               */
/* ------------------------------------------------------------------ */

export const CAKE_FLAVORS = ["clover-vanilla", "carrot-honey", "acorn-cocoa"] as const;
export type CakeFlavor = (typeof CAKE_FLAVORS)[number];

export const FROSTING_STYLES = ["cream-swirl", "berry-glaze", "mint-drizzle"] as const;
export type FrostingStyle = (typeof FROSTING_STYLES)[number];

/** Original Gooby-world toppings; glyph + label + shape are all non-color cues. */
export const DECORATION_KINDS = [
  "sugar-clover",
  "candied-carrot",
  "meringue-puff",
  "chocolate-acorn",
  "berry-pearl",
  "honey-star",
] as const;
export type DecorationKind = (typeof DECORATION_KINDS)[number];

export interface DecorationCue {
  readonly glyph: string;
  readonly label: { readonly en: string; readonly de: string };
  readonly shape: "clover" | "stick" | "puff" | "acorn" | "pearl" | "star";
}

export const DECORATION_CUES: Readonly<Record<DecorationKind, DecorationCue>> = {
  "sugar-clover": { glyph: "☘", label: { en: "Sugar clover", de: "Zuckerklee" }, shape: "clover" },
  "candied-carrot": { glyph: "🥕", label: { en: "Candied carrot", de: "Kandierte Karotte" }, shape: "stick" },
  "meringue-puff": { glyph: "☁", label: { en: "Meringue puff", de: "Baiserwölkchen" }, shape: "puff" },
  "chocolate-acorn": { glyph: "🌰", label: { en: "Chocolate acorn", de: "Schoko-Eichel" }, shape: "acorn" },
  "berry-pearl": { glyph: "●", label: { en: "Berry pearl", de: "Beerenperle" }, shape: "pearl" },
  "honey-star": { glyph: "★", label: { en: "Honey star", de: "Honigstern" }, shape: "star" },
};

export const FLAVOR_CUES: Readonly<Record<CakeFlavor, { readonly glyph: string; readonly label: { readonly en: string; readonly de: string } }>> = {
  "clover-vanilla": { glyph: "❀", label: { en: "Clover vanilla", de: "Klee-Vanille" } },
  "carrot-honey": { glyph: "🥕", label: { en: "Carrot honey", de: "Karotte-Honig" } },
  "acorn-cocoa": { glyph: "🌰", label: { en: "Acorn cocoa", de: "Eichel-Kakao" } },
};

export const FROSTING_CUES: Readonly<Record<FrostingStyle, { readonly glyph: string; readonly label: { readonly en: string; readonly de: string } }>> = {
  "cream-swirl": { glyph: "〰", label: { en: "Cream swirl", de: "Sahnewirbel" } },
  "berry-glaze": { glyph: "◠", label: { en: "Berry glaze", de: "Beerenglasur" } },
  "mint-drizzle": { glyph: "≈", label: { en: "Mint drizzle", de: "Minz-Guss" } },
};

/** Bunny customers waiting in the atelier queue (original characters). */
export const CUSTOMER_NAMES = [
  { en: "Poppy", de: "Poppy", glyph: "🐰" },
  { en: "Nutmeg", de: "Muskat", glyph: "🐿" },
  { en: "Maple", de: "Ahorn", glyph: "🦫" },
  { en: "Clover", de: "Klee", glyph: "🐭" },
  { en: "Bramble", de: "Dorn", glyph: "🦔" },
] as const;

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export const ORDERS_PER_ROUND = 3;

export interface CakeOrder {
  /** Zero-based customer position in the queue. */
  readonly index: number;
  readonly customer: number;
  readonly flavor: CakeFlavor;
  /** 1–3 sponge layers; escalates with the customer index. */
  readonly layers: number;
  readonly frosting: FrostingStyle;
  /** 2–4 distinct decorations; escalates with the customer index. */
  readonly decorations: readonly DecorationKind[];
  /** Serving faster than this earns the speed bonus. */
  readonly parSeconds: number;
}

/** Escalating complexity: customer i wants i+1 layers and i+2 decorations. */
export function orderComplexity(index: number): { readonly layers: number; readonly decorations: number } {
  const clamped = Math.max(0, Math.min(ORDERS_PER_ROUND - 1, Math.floor(index)));
  return { layers: clamped + 1, decorations: clamped + 2 };
}

/** Par times scale with the amount of work an order asks for. */
export function orderParSeconds(index: number): number {
  const { layers, decorations } = orderComplexity(index);
  return 20 + layers * 14 + decorations * 5;
}

export function rollOrder(rng: RandomSource, index: number, previous?: CakeOrder): CakeOrder {
  const { layers, decorations } = orderComplexity(index);
  let flavor = rng.pick(CAKE_FLAVORS);
  if (previous && flavor === previous.flavor) {
    flavor = CAKE_FLAVORS[(CAKE_FLAVORS.indexOf(flavor) + 1) % CAKE_FLAVORS.length] as CakeFlavor;
  }
  let frosting = rng.pick(FROSTING_STYLES);
  if (previous && frosting === previous.frosting) {
    frosting = FROSTING_STYLES[(FROSTING_STYLES.indexOf(frosting) + 1) % FROSTING_STYLES.length] as FrostingStyle;
  }
  const pool = [...DECORATION_KINDS];
  const chosen: DecorationKind[] = [];
  for (let pickIndex = 0; pickIndex < decorations; pickIndex += 1) {
    const at = rng.int(0, pool.length);
    chosen.push(pool[at] as DecorationKind);
    pool.splice(at, 1);
  }
  return {
    index,
    customer: rng.int(0, CUSTOMER_NAMES.length),
    flavor,
    layers,
    frosting,
    decorations: chosen,
    parSeconds: orderParSeconds(index),
  };
}

/** Rolls the full queue for a scored shift; complexity escalates in order. */
export function rollOrderQueue(rng: RandomSource): readonly CakeOrder[] {
  const orders: CakeOrder[] = [];
  for (let index = 0; index < ORDERS_PER_ROUND; index += 1) {
    orders.push(rollOrder(rng, index, orders[index - 1]));
  }
  return orders;
}

/* ------------------------------------------------------------------ */
/* Bake phase: the stop-needle fluff gauge                             */
/* ------------------------------------------------------------------ */

/** Fraction of the gauge (centered) that counts as the perfect fluff zone. */
export const FLUFF_PERFECT_ZONE = 0.12;
/** Beyond this distance from center the sponge quality bottoms out. */
export const FLUFF_ZERO_DISTANCE = 0.5;

/**
 * Needle position in [0, 1] after `elapsed` seconds of oscillation — a
 * triangle wave so speed is constant and stops are fully skill-based.
 */
export function needlePositionAt(elapsedSeconds: number, sweepsPerSecond: number): number {
  const phase = (elapsedSeconds * sweepsPerSecond) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

/** Needle speed ramps gently with the customer index and per-layer count. */
export function needleSweepsPerSecond(orderIndex: number, layerIndex: number): number {
  return 0.55 + orderIndex * 0.2 + layerIndex * 0.1;
}

/** Sponge fluff quality in [0, 1] from where the needle stopped. */
export function fluffQuality(needlePosition: number): number {
  const distance = Math.abs(needlePosition - 0.5);
  if (distance <= FLUFF_PERFECT_ZONE / 2) return 1;
  if (distance >= FLUFF_ZERO_DISTANCE) return 0;
  return 1 - (distance - FLUFF_PERFECT_ZONE / 2) / (FLUFF_ZERO_DISTANCE - FLUFF_PERFECT_ZONE / 2);
}

/* ------------------------------------------------------------------ */
/* Stack phase: drag alignment and stability                           */
/* ------------------------------------------------------------------ */

/** A drop within this fraction of the layer width counts as perfect. */
export const STACK_PERFECT_OFFSET = 0.06;
/** Offsets beyond half the layer width slide off entirely. */
export const STACK_MAX_OFFSET = 0.5;

/**
 * Alignment score in [0, 1] for a dropped layer. `offset` is the horizontal
 * distance between layer center and target center, as a fraction of the
 * layer width.
 */
export function layerAlignment(offset: number): number {
  const distance = Math.abs(offset);
  if (distance <= STACK_PERFECT_OFFSET) return 1;
  if (distance >= STACK_MAX_OFFSET) return 0;
  return 1 - (distance - STACK_PERFECT_OFFSET) / (STACK_MAX_OFFSET - STACK_PERFECT_OFFSET);
}

/**
 * Tower stability in [0, 1]: the mean alignment softened by the worst drop,
 * so one badly slid layer wobbles the whole cake.
 */
export function stackStability(alignments: readonly number[]): number {
  if (alignments.length === 0) return 1;
  let sum = 0;
  let worst = 1;
  for (const alignment of alignments) {
    sum += alignment;
    worst = Math.min(worst, alignment);
  }
  const mean = sum / alignments.length;
  return Math.max(0, Math.min(1, mean * 0.65 + worst * 0.35));
}

/* ------------------------------------------------------------------ */
/* Frost phase: held-swipe coverage                                    */
/* ------------------------------------------------------------------ */

/** Horizontal frosting cells across the cake face. */
export const FROST_CELLS = 24;
/** Serving requires at least this much of the cake face frosted. */
export const FROST_REQUIRED_COVERAGE = 0.9;

export type FrostCells = boolean[];

export function createFrostCells(): FrostCells {
  return Array.from({ length: FROST_CELLS }, () => false);
}

/**
 * Marks every cell a held swipe crossed between two normalized x positions
 * (each in [0, 1]). Returns how many new cells the stroke frosted.
 */
export function applyFrostStroke(cells: FrostCells, fromX: number, toX: number): number {
  const low = Math.max(0, Math.min(fromX, toX));
  const high = Math.min(1, Math.max(fromX, toX));
  if (high < 0 || low > 1 || high < low) return 0;
  const first = Math.max(0, Math.min(FROST_CELLS - 1, Math.floor(low * FROST_CELLS)));
  const last = Math.max(0, Math.min(FROST_CELLS - 1, Math.ceil(high * FROST_CELLS) - 1));
  let added = 0;
  for (let cell = first; cell <= last; cell += 1) {
    if (!cells[cell]) {
      cells[cell] = true;
      added += 1;
    }
  }
  return added;
}

export function frostCoverage(cells: readonly boolean[]): number {
  if (cells.length === 0) return 0;
  let covered = 0;
  for (const cell of cells) if (cell) covered += 1;
  return covered / cells.length;
}

/* ------------------------------------------------------------------ */
/* Decorate phase                                                      */
/* ------------------------------------------------------------------ */

export interface PlacedDecoration {
  readonly kind: DecorationKind;
  /** Normalized position on the cake top, both in [0, 1]. */
  readonly x: number;
  readonly y: number;
}

export interface DecorationJudgement {
  /** Distinct required kinds that were placed. */
  readonly matched: number;
  readonly required: number;
  /** Placements of kinds the order never asked for. */
  readonly extras: number;
  readonly complete: boolean;
  /** Score share in [0, 1]: matches minus a soft extras penalty. */
  readonly quality: number;
}

export function judgeDecorations(
  placed: readonly PlacedDecoration[],
  required: readonly DecorationKind[],
): DecorationJudgement {
  const requiredSet = new Set(required);
  const matchedSet = new Set<DecorationKind>();
  let extras = 0;
  for (const decoration of placed) {
    if (requiredSet.has(decoration.kind)) matchedSet.add(decoration.kind);
    else extras += 1;
  }
  const matched = matchedSet.size;
  const quality = Math.max(
    0,
    Math.min(1, (required.length === 0 ? 1 : matched / required.length) - extras * 0.15),
  );
  return {
    matched,
    required: required.length,
    extras,
    complete: matched === required.length,
    quality,
  };
}

/* ------------------------------------------------------------------ */
/* Scoring: quality + speed + combo                                    */
/* ------------------------------------------------------------------ */

/** Step results at or above this quality extend the perfect-step combo. */
export const COMBO_GREAT_THRESHOLD = 0.85;
export const COMBO_MAX = 8;

/** Advances the perfect-step combo; great steps chain, sloppy ones reset. */
export function nextCombo(combo: number, stepQuality: number): number {
  if (stepQuality >= COMBO_GREAT_THRESHOLD) return Math.min(COMBO_MAX, combo + 1);
  return 0;
}

/** Score multiplier granted by the current combo chain (1.0 – 1.8). */
export function comboMultiplier(combo: number): number {
  return 1 + Math.min(COMBO_MAX, Math.max(0, combo)) * 0.1;
}

export interface OrderResult {
  readonly bakeQuality: number;
  readonly stackQuality: number;
  readonly frostQuality: number;
  readonly decorationQuality: number;
  readonly quality: number;
  readonly qualityPoints: number;
  readonly speedPoints: number;
  readonly comboPoints: number;
  readonly total: number;
  readonly elapsedSeconds: number;
  readonly stars: 1 | 2 | 3;
}

export interface OrderScoreInput {
  readonly order: CakeOrder;
  /** Per-layer fluff qualities from the stop-needle bakes. */
  readonly fluff: readonly number[];
  /** Per-layer drop alignments. */
  readonly alignments: readonly number[];
  readonly coverage: number;
  readonly decorations: DecorationJudgement;
  readonly elapsedSeconds: number;
  /** Combo peaks reached while working this order, summed as bonus points. */
  readonly comboBonus: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function scoreOrder(input: OrderScoreInput): OrderResult {
  const bakeQuality = mean(input.fluff);
  const stackQuality = stackStability(input.alignments);
  const frostQuality = Math.max(0, Math.min(1, input.coverage));
  const decorationQuality = input.decorations.quality;
  const quality =
    bakeQuality * 0.3 + stackQuality * 0.25 + frostQuality * 0.2 + decorationQuality * 0.25;
  const qualityPoints = Math.round(quality * 600);
  const speedRatio = input.order.parSeconds <= 0
    ? 0
    : Math.max(0, Math.min(1, 1 - input.elapsedSeconds / input.order.parSeconds));
  const speedPoints = Math.round(speedRatio * 200);
  const comboPoints = Math.max(0, Math.round(input.comboBonus));
  const total = qualityPoints + speedPoints + comboPoints;
  const stars: 1 | 2 | 3 = quality >= 0.85 ? 3 : quality >= 0.6 ? 2 : 1;
  return {
    bakeQuality,
    stackQuality,
    frostQuality,
    decorationQuality,
    quality,
    qualityPoints,
    speedPoints,
    comboPoints,
    total,
    elapsedSeconds: input.elapsedSeconds,
    stars,
  };
}

/** Replay-safe coin/XP settlement caps aligned with the launch roster. */
export function settlePayout(totalScore: number): MinigamePayout {
  const score = Math.max(0, Math.floor(totalScore));
  return {
    score,
    coins: Math.min(40, Math.floor(score / 60)),
    xp: Math.min(90, Math.floor(score / 30)),
  };
}

/* ------------------------------------------------------------------ */
/* Order session state machine                                         */
/* ------------------------------------------------------------------ */

export type AtelierPhase = "flavor" | "bake" | "stack" | "frost" | "decorate" | "serve" | "done";

export type StepFeedback =
  | { readonly kind: "flavor"; readonly correct: boolean }
  | { readonly kind: "bake"; readonly quality: number; readonly combo: number }
  | { readonly kind: "stack"; readonly alignment: number; readonly combo: number }
  | { readonly kind: "frost"; readonly coverage: number; readonly ready: boolean }
  | { readonly kind: "frost-style"; readonly correct: boolean }
  | { readonly kind: "decorate"; readonly accepted: boolean; readonly judgement: DecorationJudgement }
  | { readonly kind: "serve"; readonly result: OrderResult }
  | { readonly kind: "round-complete"; readonly totalScore: number };

export interface BakedLayer {
  readonly fluff: number;
  /** Baked height as a fraction of the nominal layer height (0.75 – 1.1). */
  readonly heightScale: number;
}

export interface StackedLayer extends BakedLayer {
  readonly offset: number;
  readonly alignment: number;
}

export interface SwingingLayer extends BakedLayer {
  /** Normalized x center in [0, 1]; drops target 0.5. */
  x: number;
  held: boolean;
}

export interface AtelierSessionOptions {
  /** True in the free-decorate sandbox: no scoring, queue, or payout. */
  readonly sandbox?: boolean;
}

/**
 * One full scored shift: three escalating customer orders, each walking the
 * flavor → bake → stack → frost → decorate → serve pipeline. All mutation
 * goes through explicit player inputs plus `update(dt)`; rendering layers
 * read the exposed state and never mutate it.
 */
export class AtelierSession {
  readonly orders: readonly CakeOrder[];
  readonly sandbox: boolean;

  private orderIndex = 0;
  private phaseValue: AtelierPhase = "flavor";
  private elapsedInOrder = 0;
  private bakeElapsed = 0;
  private baking = false;
  private layersBaked: BakedLayer[] = [];
  private stacked: StackedLayer[] = [];
  private swinging: SwingingLayer | null = null;
  private swingElapsed = 0;
  private frostCellsValue: FrostCells = createFrostCells();
  private frostStyleValue: FrostingStyle | null = null;
  private nozzleX = 0;
  private placedValue: PlacedDecoration[] = [];
  private selectedFlavorValue: CakeFlavor | null = null;
  private comboValue = 0;
  private bestComboValue = 0;
  private comboBonusInOrder = 0;
  private resultsValue: OrderResult[] = [];
  private actionsValue = 0;

  constructor(rng: RandomSource, options: AtelierSessionOptions = {}) {
    this.sandbox = options.sandbox === true;
    this.orders = this.sandbox ? [rollOrder(rng, ORDERS_PER_ROUND - 1)] : rollOrderQueue(rng);
  }

  get phase(): AtelierPhase {
    return this.phaseValue;
  }

  get currentOrder(): CakeOrder {
    const order = this.orders[Math.min(this.orderIndex, this.orders.length - 1)];
    if (!order) throw new Error("Atelier session has no orders");
    return order;
  }

  get currentOrderIndex(): number {
    return this.orderIndex;
  }

  get selectedFlavor(): CakeFlavor | null {
    return this.selectedFlavorValue;
  }

  get frostStyle(): FrostingStyle | null {
    return this.frostStyleValue;
  }

  get combo(): number {
    return this.comboValue;
  }

  get bestCombo(): number {
    return this.bestComboValue;
  }

  get actions(): number {
    return this.actionsValue;
  }

  get results(): readonly OrderResult[] {
    return this.resultsValue;
  }

  get totalScore(): number {
    let total = 0;
    for (const result of this.resultsValue) total += result.total;
    return total;
  }

  get finished(): boolean {
    return this.phaseValue === "done";
  }

  get elapsedSeconds(): number {
    return this.elapsedInOrder;
  }

  /** Needle position in [0, 1] while the oven gauge oscillates. */
  get needlePosition(): number {
    return needlePositionAt(
      this.bakeElapsed,
      needleSweepsPerSecond(this.sandbox ? 0 : this.orderIndex, this.layersBaked.length),
    );
  }

  get bakedLayerCount(): number {
    return this.layersBaked.length;
  }

  get stackedLayers(): readonly StackedLayer[] {
    return this.stacked;
  }

  get swingingLayer(): SwingingLayer | null {
    return this.swinging;
  }

  get frostCells(): readonly boolean[] {
    return this.frostCellsValue;
  }

  get coverage(): number {
    return frostCoverage(this.frostCellsValue);
  }

  get coverageReady(): boolean {
    return this.coverage >= FROST_REQUIRED_COVERAGE;
  }

  get nozzlePosition(): number {
    return this.nozzleX;
  }

  get placedDecorations(): readonly PlacedDecoration[] {
    return this.placedValue;
  }

  get decorationJudgement(): DecorationJudgement {
    return judgeDecorations(this.placedValue, this.currentOrder.decorations);
  }

  /** Advances phase-local clocks; paused hosts simply pass dt = 0. */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError("Atelier update delta must be finite and non-negative");
    }
    if (this.phaseValue === "done") return;
    this.elapsedInOrder += dt;
    if (this.phaseValue === "bake" && this.baking) this.bakeElapsed += dt;
    if (this.phaseValue === "stack" && this.swinging && !this.swinging.held) {
      this.swingElapsed += dt;
      const sway = 0.5 + Math.sin(this.swingElapsed * (1.4 + this.orderIndex * 0.35)) * 0.34;
      this.swinging.x = sway;
    }
  }

  /* -------------------------- flavor ----------------------------- */

  /**
   * Picking the batter. In scored play only the ordered flavor loads the
   * oven; the free-decorate sandbox accepts any creative choice.
   */
  selectFlavor(flavor: CakeFlavor): StepFeedback {
    this.assertPhase("flavor");
    this.actionsValue += 1;
    const correct = this.sandbox || flavor === this.currentOrder.flavor;
    if (correct) {
      this.selectedFlavorValue = flavor;
      this.phaseValue = "bake";
      this.baking = true;
      this.bakeElapsed = 0;
    } else {
      this.comboValue = 0;
    }
    return { kind: "flavor", correct };
  }

  /* --------------------------- bake ------------------------------ */

  /** Stops the fluff needle for the current layer. */
  stopNeedle(): StepFeedback {
    this.assertPhase("bake");
    if (!this.baking) throw new Error("The oven needle is not sweeping");
    this.actionsValue += 1;
    const quality = fluffQuality(this.needlePosition);
    this.applyComboStep(quality);
    this.layersBaked.push({ fluff: quality, heightScale: 0.75 + quality * 0.35 });
    if (this.layersBaked.length >= this.currentOrder.layers) {
      this.baking = false;
      this.phaseValue = "stack";
      this.prepareNextSwing();
    } else {
      this.bakeElapsed = 0;
    }
    return { kind: "bake", quality, combo: this.comboValue };
  }

  /* --------------------------- stack ----------------------------- */

  private prepareNextSwing(): void {
    const layer = this.layersBaked[this.stacked.length];
    if (!layer) {
      this.swinging = null;
      return;
    }
    this.swingElapsed = 0;
    this.swinging = { ...layer, x: 0.5, held: false };
  }

  /** A held pointer (or held arrow keys) grabs the swinging layer. */
  grabLayer(): boolean {
    if (this.phaseValue !== "stack" || !this.swinging) return false;
    this.swinging.held = true;
    this.actionsValue += 1;
    return true;
  }

  /** Drags the held layer to a normalized x in [0, 1]. */
  moveLayer(x: number): void {
    if (this.phaseValue !== "stack" || !this.swinging || !this.swinging.held) return;
    this.swinging.x = Math.max(0, Math.min(1, x));
  }

  /** Releasing drops the layer; alignment against center scores the drop. */
  dropLayer(): StepFeedback {
    this.assertPhase("stack");
    const layer = this.swinging;
    if (!layer) throw new Error("No layer is ready to drop");
    this.actionsValue += 1;
    const offset = layer.x - 0.5;
    const alignment = layerAlignment(offset);
    this.applyComboStep(alignment);
    this.stacked.push({
      fluff: layer.fluff,
      heightScale: layer.heightScale,
      offset,
      alignment,
    });
    this.swinging = null;
    if (this.stacked.length >= this.currentOrder.layers) {
      this.phaseValue = "frost";
      this.frostCellsValue = createFrostCells();
      this.frostStyleValue = null;
      this.nozzleX = 0;
    } else {
      this.prepareNextSwing();
    }
    return { kind: "stack", alignment, combo: this.comboValue };
  }

  /* --------------------------- frost ----------------------------- */

  /** Loading the piping bag: scored play requires the ordered style. */
  selectFrosting(style: FrostingStyle): StepFeedback {
    this.assertPhase("frost");
    this.actionsValue += 1;
    const correct = this.sandbox || style === this.currentOrder.frosting;
    if (correct) this.frostStyleValue = style;
    else this.comboValue = 0;
    return { kind: "frost-style", correct };
  }

  /**
   * A held swipe across the cake face. Positions are normalized x in [0, 1];
   * the host feeds consecutive pointer (or keyboard-nozzle) positions.
   */
  frostSweep(fromX: number, toX: number): StepFeedback {
    this.assertPhase("frost");
    if (this.frostStyleValue === null) {
      return { kind: "frost", coverage: this.coverage, ready: this.coverageReady };
    }
    this.actionsValue += 1;
    applyFrostStroke(this.frostCellsValue, fromX, toX);
    this.nozzleX = Math.max(0, Math.min(1, toX));
    return { kind: "frost", coverage: this.coverage, ready: this.coverageReady };
  }

  /** Confirms frosting once coverage is at or above the 90% requirement. */
  finishFrosting(): StepFeedback {
    this.assertPhase("frost");
    if (!this.coverageReady) {
      return { kind: "frost", coverage: this.coverage, ready: false };
    }
    this.actionsValue += 1;
    this.applyComboStep(this.coverage);
    this.phaseValue = "decorate";
    this.placedValue = [];
    return { kind: "frost", coverage: this.coverage, ready: true };
  }

  /* -------------------------- decorate --------------------------- */

  /** Places one decoration on the cake top (normalized coordinates). */
  placeDecoration(kind: DecorationKind, x: number, y: number): StepFeedback {
    this.assertPhase("decorate");
    this.actionsValue += 1;
    const duplicate = this.placedValue.some((existing) => existing.kind === kind);
    const accepted = !duplicate;
    if (accepted) {
      this.placedValue.push({
        kind,
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      });
      if (!this.currentOrder.decorations.includes(kind)) this.comboValue = 0;
    }
    return { kind: "decorate", accepted, judgement: this.decorationJudgement };
  }

  /** Lifts a mistakenly placed decoration off the cake again. */
  removeDecoration(kind: DecorationKind): boolean {
    if (this.phaseValue !== "decorate") return false;
    const index = this.placedValue.findIndex((existing) => existing.kind === kind);
    if (index < 0) return false;
    this.actionsValue += 1;
    this.placedValue.splice(index, 1);
    return true;
  }

  /**
   * Ready to hand over once every ordered decoration is on the cake; the
   * sandbox only asks for at least one topping before showing the cake off.
   */
  get serveReady(): boolean {
    if (this.phaseValue !== "decorate") return false;
    if (this.sandbox) return this.placedValue.length >= 1;
    return this.decorationJudgement.complete;
  }

  /* --------------------------- serve ----------------------------- */

  /** Serves the cake to the waiting customer and scores the order. */
  serve(): StepFeedback {
    this.assertPhase("decorate");
    if (!this.serveReady) {
      return { kind: "decorate", accepted: false, judgement: this.decorationJudgement };
    }
    this.actionsValue += 1;
    const judgement = this.decorationJudgement;
    this.applyComboStep(judgement.quality);
    const result = scoreOrder({
      order: this.currentOrder,
      fluff: this.layersBaked.map((layer) => layer.fluff),
      alignments: this.stacked.map((layer) => layer.alignment),
      coverage: this.coverage,
      decorations: judgement,
      elapsedSeconds: this.elapsedInOrder,
      comboBonus: this.comboBonusInOrder,
    });
    if (!this.sandbox) this.resultsValue.push(result);
    if (this.sandbox || this.orderIndex >= this.orders.length - 1) {
      this.phaseValue = this.sandbox ? "serve" : "done";
    } else {
      this.orderIndex += 1;
      this.resetForNextOrder();
    }
    return { kind: "serve", result };
  }

  /** Sandbox only: clears the counter for another free bake. */
  restartSandboxCake(): void {
    if (!this.sandbox) throw new Error("Only the sandbox can restart mid-session");
    this.resetForNextOrder();
  }

  /** Scores a shift that was finished early from the pause menu. */
  payout(): MinigamePayout {
    if (this.sandbox) return { score: 0, coins: 0, xp: 0 };
    return settlePayout(this.totalScore);
  }

  private resetForNextOrder(): void {
    this.phaseValue = "flavor";
    this.elapsedInOrder = 0;
    this.bakeElapsed = 0;
    this.baking = false;
    this.layersBaked = [];
    this.stacked = [];
    this.swinging = null;
    this.swingElapsed = 0;
    this.frostCellsValue = createFrostCells();
    this.frostStyleValue = null;
    this.nozzleX = 0;
    this.placedValue = [];
    this.selectedFlavorValue = null;
    this.comboBonusInOrder = 0;
  }

  private applyComboStep(stepQuality: number): void {
    this.comboValue = nextCombo(this.comboValue, stepQuality);
    this.bestComboValue = Math.max(this.bestComboValue, this.comboValue);
    if (this.comboValue >= 2) {
      this.comboBonusInOrder += Math.round(10 * (comboMultiplier(this.comboValue) - 1) * 10);
    }
  }

  private assertPhase(expected: AtelierPhase): void {
    if (this.phaseValue !== expected) {
      throw new Error(`Expected atelier phase ${expected}, but the session is in ${this.phaseValue}`);
    }
  }
}
