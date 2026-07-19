import {
  PROCEDURAL_BEATMAPS,
  compileChartFile,
  type RhythmBeatmap,
  type RhythmDifficulty,
  type RhythmSongId,
} from "./model";
import { DEWDROP_DERBY_CHART } from "./songs/dewdrop-derby";
import { FIREFLY_WALTZ_CHART } from "./songs/firefly-waltz";
import type { RhythmChartFile } from "./songs/format";

/** File-backed chart data for the two authored songs. */
export const RHYTHM_CHART_FILES: readonly RhythmChartFile[] = [
  FIREFLY_WALTZ_CHART,
  DEWDROP_DERBY_CHART,
];

/** The complete five-song catalog: three procedural, two file-backed. */
export const RHYTHM_BEATMAPS: Readonly<
  Record<RhythmSongId, Readonly<Record<RhythmDifficulty, RhythmBeatmap>>>
> = {
  ...PROCEDURAL_BEATMAPS,
  "firefly-waltz": {
    easy: compileChartFile(FIREFLY_WALTZ_CHART, "easy"),
    hard: compileChartFile(FIREFLY_WALTZ_CHART, "hard"),
  },
  "dewdrop-derby": {
    easy: compileChartFile(DEWDROP_DERBY_CHART, "easy"),
    hard: compileChartFile(DEWDROP_DERBY_CHART, "hard"),
  },
};
