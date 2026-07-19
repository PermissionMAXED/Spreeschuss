/**
 * Authored chart-file format for Rhythm Hop songs.
 *
 * Each song ships as a data file under `songs/` that lists every note
 * explicitly in musical beats. The model compiles a chart file into a frozen
 * `RhythmBeatmap` (milliseconds on the audio clock), so charts stay readable,
 * reviewable, and deterministic.
 *
 * Chart files must stay runtime-import-free (type-only imports) so the
 * strip-types specialist test runner can load them directly; each file
 * declares its own tiny `n(beat, lane, holdBeats?)` note helper.
 */

export type ChartLane = 0 | 1 | 2;

export interface ChartNoteSpec {
  /** Position in beats from the song's first playable beat. */
  readonly beat: number;
  readonly lane: ChartLane;
  /** When present and positive, the note is a hold lasting this many beats. */
  readonly holdBeats?: number;
}

export interface RhythmChartFile {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: string;
  readonly bpm: number;
  /** Lead-in before the first beat, matching the shared 1.8s count-in. */
  readonly audioOffsetMs: number;
  readonly easy: readonly ChartNoteSpec[];
  readonly hard: readonly ChartNoteSpec[];
}
