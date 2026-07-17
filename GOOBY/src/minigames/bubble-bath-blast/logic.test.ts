import { describe, expect, it } from "vitest";
import {
  findTouchingChain,
  resolveBubbleTap,
  type BubbleNode,
  type BubbleScoreState,
} from "./logic";

const bubble = (
  id: number,
  x: number,
  y: number,
  color: BubbleNode["color"] = "coral",
): BubbleNode => ({ id, x, y, color, kind: "bubble", radius: 5 });

const initial: BubbleScoreState = { score: 0, stars: 0, combo: 0, timePenalty: 0 };

describe("Bubble Bath Blast rules", () => {
  it("flood-fills only same-color bubbles connected by touch", () => {
    const nodes = [
      bubble(1, 10, 10),
      bubble(2, 20, 10),
      bubble(3, 30, 10),
      bubble(4, 20, 10, "mint"),
      bubble(5, 70, 70),
    ];

    expect(findTouchingChain(nodes, 1)).toEqual([1, 2, 3]);
  });

  it("uses pixel distances and isotropic radii across differently shaped playfields", () => {
    const portraitEquivalent = [
      bubble(1, 20, 20),
      bubble(2, 30, 20),
      bubble(3, 30, 25),
    ];
    const landscapeEquivalent = [
      bubble(1, 20, 20),
      bubble(2, 25, 20),
      bubble(3, 25, 30),
    ];

    expect(findTouchingChain(portraitEquivalent, 1, { width: 200, height: 400 })).toEqual([1, 2, 3]);
    expect(findTouchingChain(landscapeEquivalent, 1, { width: 400, height: 200 })).toEqual([1, 2, 3]);
    expect(
      findTouchingChain([bubble(1, 20, 20), bubble(2, 20, 30)], 1, {
        width: 200,
        height: 400,
      }),
    ).toEqual([1]);
  });

  it("awards a star burst for a chain of four or more", () => {
    const nodes = [bubble(1, 10, 10), bubble(2, 20, 10), bubble(3, 30, 10), bubble(4, 40, 10)];
    const result = resolveBubbleTap(initial, nodes, 2);

    expect(result.starBurst).toBe(true);
    expect(result.stars).toBe(1);
    expect(result.removedIds).toHaveLength(4);
    expect(result.score).toBeGreaterThan(4 * 35);
  });

  it("applies the forbidden-soap score, time, and combo penalty", () => {
    const soap: BubbleNode = {
      id: 9,
      kind: "soap",
      color: "sky",
      x: 50,
      y: 50,
      radius: 5,
    };
    const result = resolveBubbleTap(
      { score: 500, stars: 2, combo: 5, timePenalty: 0 },
      [soap],
      soap.id,
    );

    expect(result).toMatchObject({
      score: 380,
      stars: 2,
      combo: 0,
      timePenalty: 4,
      soapHit: true,
      removedIds: [],
    });
  });
});
