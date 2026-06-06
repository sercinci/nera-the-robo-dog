/**
 * Per-turn latency instrumentation. Single clock (the orchestrator's). The kiosk
 * sends back its 2 browser-side stamps (audio-start, screen-rendered) to reconcile.
 *
 * Hero KPI  = ttsFirstAudioAt - speechCommitAt  ("you stop talking -> Nera answers")
 * Screen KPI = screenRenderedAt - speechCommitAt (only when info is pushed)
 */
import type { Timings } from "@nera/contracts";

export type Stage =
  | "ringAt"
  | "welcomeAudioStartAt"
  | "speechCommitAt"
  | "agentFirstTokenAt"
  | "destinationEmittedAt"
  | "screenRenderedAt"
  | "ttsFirstAudioAt";

export const STAGE_ORDER: Stage[] = [
  "ringAt",
  "welcomeAudioStartAt",
  "speechCommitAt",
  "agentFirstTokenAt",
  "destinationEmittedAt",
  "screenRenderedAt",
  "ttsFirstAudioAt",
];

export interface Segment {
  from: string;
  to: string;
  ms: number;
}

export class Turn {
  readonly timings: Timings = {};

  mark(stage: Stage, at: number = Date.now()): void {
    (this.timings as Record<string, number>)[stage] = at;
  }

  private diff(a: Stage, b: Stage): number | undefined {
    const x = this.timings[a];
    const y = this.timings[b];
    return typeof x === "number" && typeof y === "number" ? y - x : undefined;
  }

  heroMs(): number | undefined {
    return this.diff("speechCommitAt", "ttsFirstAudioAt");
  }

  screenMs(): number | undefined {
    return this.diff("speechCommitAt", "screenRenderedAt");
  }

  /** Ordered deltas between consecutive stamps that are actually present. */
  segments(): Segment[] {
    const present = STAGE_ORDER.filter((s) => typeof this.timings[s] === "number");
    const out: Segment[] = [];
    for (let i = 1; i < present.length; i++) {
      const from = present[i - 1]!;
      const to = present[i]!;
      out.push({ from, to, ms: (this.timings[to] as number) - (this.timings[from] as number) });
    }
    return out;
  }
}
