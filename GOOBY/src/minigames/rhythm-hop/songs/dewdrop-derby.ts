import type { ChartLane, ChartNoteSpec, RhythmChartFile } from "./format";

/**
 * "Dewdrop Derby" — an original morning sprint through wet clover.
 *
 * Sixteen bars of four beats at a brisk 132 BPM. The easy chart bounces on
 * the half notes with three long dew-slide holds; the hard chart runs the
 * quarter notes, splashes off-beats at bar turns, and keeps the same slides.
 */
const n = (beat: number, lane: ChartLane, holdBeats?: number): ChartNoteSpec =>
  holdBeats === undefined ? { beat, lane } : { beat, lane, holdBeats };

export const DEWDROP_DERBY_CHART: RhythmChartFile = {
  id: "dewdrop-derby",
  title: "Dewdrop Derby",
  subtitle: "Morning dew dash",
  icon: "💠",
  bpm: 132,
  audioOffsetMs: 1_800,
  easy: [
    // Lap one: warm-up bounces.
    n(0, 1),
    n(2, 0),
    n(4, 2),
    n(6, 1),
    n(8, 0),
    n(10, 2),
    n(12, 1),
    n(14, 0),
    // Lap two: first dew slide.
    n(16, 2, 3),
    n(20, 1),
    n(22, 0),
    n(24, 1),
    n(26, 2),
    n(28, 0),
    n(30, 1),
    // Lap three: slide on the left.
    n(32, 0, 3),
    n(36, 2),
    n(38, 1),
    n(40, 2),
    n(42, 0),
    n(44, 1),
    n(46, 2),
    // Final lap: middle slide to the finish.
    n(48, 1, 3),
    n(52, 0),
    n(54, 2),
    n(56, 0),
    n(58, 2),
    n(60, 1),
    n(62, 1),
  ],
  hard: [
    // Lap one: quarter-note sprint with a splash into lap two.
    n(0, 1),
    n(1, 0),
    n(2, 2),
    n(3, 1),
    n(4, 0),
    n(5, 2),
    n(6, 1),
    n(7, 0),
    n(7.5, 2),
    n(8, 2),
    n(9, 1),
    n(10, 0),
    n(11, 2),
    n(12, 1),
    n(13, 0),
    n(14, 2),
    n(15, 1),
    // Lap two: right-lane slide while the other paws keep moving.
    n(16, 2, 3),
    n(20, 1),
    n(21, 0),
    n(22, 1),
    n(23, 0),
    n(23.5, 1),
    n(24, 2),
    n(25, 1),
    n(26, 0),
    n(27, 1),
    n(28, 2),
    n(29, 0),
    n(30, 1),
    n(31, 0),
    // Lap three: left-lane slide, splashes at the turn.
    n(32, 0, 3),
    n(36, 2),
    n(37, 1),
    n(38, 2),
    n(39, 1),
    n(39.5, 2),
    n(40, 0),
    n(41, 1),
    n(42, 2),
    n(43, 1),
    n(44, 0),
    n(45, 2),
    n(46, 1),
    n(47, 0),
    // Final lap: middle slide, then a photo finish.
    n(48, 1, 3),
    n(52, 0),
    n(53, 2),
    n(54, 0),
    n(55, 2),
    n(55.5, 0),
    n(56, 1),
    n(57, 2),
    n(58, 0),
    n(59, 2),
    n(60, 1),
    n(61, 0),
    n(61.5, 2),
    n(62, 1),
  ],
};
