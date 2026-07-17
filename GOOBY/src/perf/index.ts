import type { RenderQuality } from "../render/renderer";

export interface PerformanceSnapshot {
  readonly averageFrameMs: number;
  readonly p95FrameMs: number;
  readonly sampleCount: number;
  readonly recommendedQuality: RenderQuality;
}

export class PerformanceProbe {
  private readonly samples: number[] = [];

  sample(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return;
    this.samples.push(frameMs);
    if (this.samples.length > 180) this.samples.shift();
  }

  snapshot(): PerformanceSnapshot {
    if (this.samples.length === 0) {
      return { averageFrameMs: 0, p95FrameMs: 0, sampleCount: 0, recommendedQuality: "balanced" };
    }
    const ordered = [...this.samples].sort((left, right) => left - right);
    const averageFrameMs = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    const p95FrameMs = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))] ?? averageFrameMs;
    const recommendedQuality: RenderQuality = p95FrameMs > 26 ? "battery" : p95FrameMs < 17 ? "high" : "balanced";
    return { averageFrameMs, p95FrameMs, sampleCount: this.samples.length, recommendedQuality };
  }
}
