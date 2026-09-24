import {
  holdActiveTopicRead,
  resolveValueTopic,
} from "@ksp-gonogo/sitrep-client";
import type { Alarm } from "./types";

/** The Topic a contract-parameter trigger is evaluated against. */
export const CONTRACTS_ACTIVE_TOPIC = "career.status.contracts.active";

/**
 * The Topic this client evaluates `alarm` against while it is armed, or null
 * when it evaluates nothing off the stream: an alarm the mod latches is the
 * mod's, a time alarm reads the view clock, an event alarm reads revealed
 * occurrences, and a fired alarm is finished.
 */
export function topicEvaluatedBy(
  alarm: Alarm,
  latchedElsewhere: boolean,
): string | null {
  if (latchedElsewhere) return null;
  if (alarm.state !== "pending" && alarm.state !== "arming") return null;
  const trigger = alarm.trigger;
  if (trigger.kind === "threshold") {
    return resolveValueTopic("data", trigger.dataKey) ?? null;
  }
  if (trigger.kind === "contract-parameter") return CONTRACTS_ACTIVE_TOPIC;
  return null;
}

/**
 * The Topics the armed alarms are evaluated against, each held up on the wire
 * for as long as some alarm needs it.
 *
 * An alarm is a subscriber in its own right. Sampling a Topic nobody holds
 * reads `pending` for ever, and one a widget has let go of reads that widget's
 * last payload, so an alarm whose Topic no widget happens to draw would never
 * fire and never stop the warp.
 */
export class AlarmTopicHolds {
  private readonly held = new Map<string, () => void>();

  /** `latchedElsewhere` is the evaluator's own rule, so a Topic is held exactly while this side evaluates it. */
  reconcile(
    alarms: readonly Alarm[],
    latchedElsewhere: (alarm: Alarm) => boolean,
  ): void {
    const wanted = new Set<string>();
    for (const alarm of alarms) {
      const topic = topicEvaluatedBy(alarm, latchedElsewhere(alarm));
      if (topic !== null) wanted.add(topic);
    }
    for (const [topic, release] of this.held) {
      if (wanted.has(topic)) continue;
      release();
      this.held.delete(topic);
    }
    for (const topic of wanted) {
      if (this.held.has(topic)) continue;
      this.held.set(topic, holdActiveTopicRead(topic, "alarm-host"));
    }
  }

  /** The Topics currently held, for a caller asking what the alarms keep up. */
  topics(): ReadonlySet<string> {
    return new Set(this.held.keys());
  }

  releaseAll(): void {
    for (const release of this.held.values()) release();
    this.held.clear();
  }
}
