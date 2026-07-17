export const BUBBLE_COLORS = ["coral", "sun", "mint", "sky", "grape"] as const;
export type BubbleColor = (typeof BUBBLE_COLORS)[number];

export interface BubbleNode {
  readonly id: number;
  readonly kind: "bubble" | "soap";
  readonly color: BubbleColor;
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

export function findTouchingChain(
  nodes: readonly BubbleNode[],
  startId: number,
  playfield: BubblePlayfield = { width: 100, height: 100 },
): readonly number[] {
  const start = nodes.find(({ id }) => id === startId);
  if (!start || start.kind !== "bubble") return [];

  const matching = nodes.filter(
    (node) => node.kind === "bubble" && node.color === start.color,
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
    return { ...state, removedIds: [], starBurst: false, soapHit: false };
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
  };
}
