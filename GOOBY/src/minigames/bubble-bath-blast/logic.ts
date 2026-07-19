export const BUBBLE_COLORS = ["coral", "sun", "mint", "sky", "grape"] as const;
export type BubbleColor = (typeof BUBBLE_COLORS)[number];
export const BUBBLE_SYMBOLS = ["heart", "sun", "diamond", "triangle", "star"] as const;
export type BubbleSymbol = (typeof BUBBLE_SYMBOLS)[number];
export type BubbleMode = "splash" | "zen";

export const BUBBLE_CUES: Readonly<Record<BubbleSymbol, {
  readonly label: string;
  readonly glyph: string;
  readonly shape: string;
  readonly pattern: string;
}>> = {
  heart: { label: "Heart", glyph: "♥", shape: "heart", pattern: "stripes" },
  sun: { label: "Sun", glyph: "☀", shape: "sun", pattern: "dots" },
  diamond: { label: "Diamond", glyph: "◆", shape: "diamond", pattern: "waves" },
  triangle: { label: "Triangle", glyph: "▼", shape: "triangle", pattern: "grid" },
  star: { label: "Star", glyph: "★", shape: "star", pattern: "rings" },
};

const COLOR_SYMBOL: Readonly<Record<BubbleColor, BubbleSymbol>> = {
  coral: "heart",
  sun: "sun",
  mint: "diamond",
  sky: "triangle",
  grape: "star",
};

export interface BubbleNode {
  readonly id: number;
  readonly kind: "bubble" | "soap" | "duck";
  readonly color: BubbleColor;
  /** Falls back to the legacy color mapping for saved/test fixtures. */
  readonly symbol?: BubbleSymbol;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface BubbleScoreState {
  readonly score: number;
  readonly stars: number;
  readonly combo: number;
  readonly timePenalty: number;
}

export interface BubblePlayfield {
  readonly width: number;
  readonly height: number;
}

export interface BubbleTapResult extends BubbleScoreState {
  readonly removedIds: readonly number[];
  readonly starBurst: boolean;
  readonly soapHit: boolean;
  readonly duckBonus: boolean;
}

export interface BubblePayout {
  readonly score: number;
  readonly coins: number;
  readonly xp: number;
}

const normalizedPlayfield = (playfield: BubblePlayfield): BubblePlayfield => ({
  width: Number.isFinite(playfield.width) && playfield.width > 0 ? playfield.width : 100,
  height: Number.isFinite(playfield.height) && playfield.height > 0 ? playfield.height : 100,
});

const isTouching = (
  first: BubbleNode,
  second: BubbleNode,
  requestedPlayfield: BubblePlayfield,
): boolean => {
  const playfield = normalizedPlayfield(requestedPlayfield);
  const isotropicUnit = Math.min(playfield.width, playfield.height) / 100;
  const deltaX = (first.x - second.x) * playfield.width / 100;
  const deltaY = (first.y - second.y) * playfield.height / 100;
  const reach = (first.radius + second.radius + 1.5) * isotropicUnit;
  return Math.hypot(deltaX, deltaY) <= reach;
};

export function bubbleSymbol(node: Pick<BubbleNode, "color" | "symbol">): BubbleSymbol {
  return node.symbol ?? COLOR_SYMBOL[node.color];
}

export function findTouchingChain(
  nodes: readonly BubbleNode[],
  startId: number,
  playfield: BubblePlayfield = { width: 100, height: 100 },
): readonly number[] {
  const start = nodes.find(({ id }) => id === startId);
  if (!start || start.kind !== "bubble") return [];

  const matching = nodes.filter(
    (node) => node.kind === "bubble" && bubbleSymbol(node) === bubbleSymbol(start),
  );
  const visited = new Set<number>([start.id]);
  const queue: BubbleNode[] = [start];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const candidate of matching) {
      if (visited.has(candidate.id) || !isTouching(current, candidate, playfield)) continue;
      visited.add(candidate.id);
      queue.push(candidate);
    }
  }

  return [...visited];
}

export function resolveBubbleTap(
  state: BubbleScoreState,
  nodes: readonly BubbleNode[],
  targetId: number,
  playfield: BubblePlayfield = { width: 100, height: 100 },
): BubbleTapResult {
  const target = nodes.find(({ id }) => id === targetId);
  if (!target) {
    return { ...state, removedIds: [], starBurst: false, soapHit: false, duckBonus: false };
  }

  if (target.kind === "soap") {
    return {
      score: Math.max(0, state.score - 120),
      stars: state.stars,
      combo: 0,
      timePenalty: state.timePenalty + 4,
      removedIds: [],
      starBurst: false,
      soapHit: true,
      duckBonus: false,
    };
  }

  if (target.kind === "duck") {
    return {
      score: state.score + 500,
      stars: state.stars,
      combo: state.combo,
      timePenalty: state.timePenalty,
      removedIds: [target.id],
      starBurst: false,
      soapHit: false,
      duckBonus: true,
    };
  }

  const removedIds = findTouchingChain(nodes, targetId, playfield);
  const starBurst = removedIds.length >= 4;
  const nextCombo = Math.min(8, state.combo + 1);
  const chainPoints = removedIds.length * 35 * nextCombo;

  return {
    score: state.score + chainPoints + (starBurst ? 240 : 0),
    stars: state.stars + (starBurst ? 1 : 0),
    combo: nextCombo,
    timePenalty: state.timePenalty,
    removedIds,
    starBurst,
    soapHit: false,
    duckBonus: false,
  };
}

/** Zen keeps the full score/best comparison but grants half the timed rewards. */
export function bubblePayout(state: BubbleScoreState, mode: BubbleMode): BubblePayout {
  const score = Math.max(0, Math.floor(state.score));
  const normal = {
    score,
    coins: Math.max(1, Math.floor(score / 220) + state.stars * 2),
    xp: Math.max(2, Math.floor(score / 100) + state.stars * 3),
  };
  return mode === "zen"
    ? { score, coins: Math.floor(normal.coins / 2), xp: Math.floor(normal.xp / 2) }
    : normal;
}
