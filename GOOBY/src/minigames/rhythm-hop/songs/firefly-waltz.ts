import type { ChartLane, ChartNoteSpec, RhythmChartFile } from "./format";

/**
 * "Firefly Waltz" — an original lantern-lit waltz in 3/4 time.
 *
 * Sixteen bars of three beats. The easy chart sways bar by bar with long
 * lantern holds on phrase downbeats; the hard chart adds third-beat lifts and
 * off-beat flickers while keeping the same phrase holds.
 */
const n = (beat: number, lane: ChartLane, holdBeats?: number): ChartNoteSpec =>
  holdBeats === undefined ? { beat, lane } : { beat, lane, holdBeats };

export const FIREFLY_WALTZ_CHART: RhythmChartFile = {
  id: "firefly-waltz",
  title: "Firefly Waltz",
  subtitle: "Lantern-lit 3/4 sway",
  icon: "🏮",
  bpm: 104,
  audioOffsetMs: 1_800,
  easy: [
    // Phrase one: a gentle sway between the lanes.
    n(0, 1),
    n(3, 0),
    n(6, 2),
    n(8, 0),
    n(9, 1),
    // Phrase two: first lantern hold on the downbeat.
    n(12, 0, 2),
    n(15, 2),
    n(18, 1),
    n(20, 2),
    n(21, 0),
    // Phrase three: hold drifts to the right lane.
    n(24, 2, 2),
    n(27, 1),
    n(30, 0),
    n(32, 1),
    n(33, 2),
    // Phrase four: the fireflies settle in the middle.
    n(36, 1, 2),
    n(39, 0),
    n(42, 2),
    n(44, 0),
    n(45, 1, 2),
  ],
  hard: [
    // Phrase one: downbeats plus third-beat lifts.
    n(0, 1),
    n(2, 0),
    n(3, 0),
    n(5, 2),
    n(6, 2),
    n(7.5, 1),
    n(9, 1),
    n(11, 0),
    // Phrase two: the first hold with flickers around it.
    n(12, 0, 2),
    n(15, 2),
    n(16.5, 1),
    n(18, 1),
    n(20, 2),
    n(21, 0),
    n(22.5, 1),
    // Phrase three: mirrored sway, right-lane hold.
    n(24, 2, 2),
    n(27, 1),
    n(28.5, 0),
    n(30, 0),
    n(31.5, 2),
    n(33, 2),
    n(35, 1),
    // Phrase four: cascading close into the final hold.
    n(36, 1, 2),
    n(39, 0),
    n(40.5, 2),
    n(42, 2),
    n(43, 1),
    n(44, 0),
    n(45, 1, 2.5),
  ],
};
