import type { Meta } from "@ksp-gonogo/sitrep-sdk";

/** One emission a command's answer puts on the stream. */
export interface AnswerEmit {
  channel: string;
  value: unknown;
  meta?: Partial<Meta>;
}

/**
 * What the craft does when a command is sent: the emits that follow it,
 * optionally after a delay. `args` narrows the case to commands whose args
 * contain every listed field with an equal value, so one command can answer
 * differently for its two directions.
 */
export interface CommandAnswerCase {
  args?: Record<string, unknown>;
  emits: AnswerEmit[];
  afterMs?: number;
}

/** Answers by command name; the first case whose `args` match wins. */
export type CommandAnswers = Record<string, CommandAnswerCase[]>;

interface AnswerTarget {
  transport: {
    setCommandHandler(
      handler: (command: string, args: unknown) => unknown,
    ): void;
  };
  emit(topic: string, payload: unknown, meta?: Partial<Meta>): void;
}

function matches(
  expected: Record<string, unknown> | undefined,
  args: unknown,
): boolean {
  if (expected === undefined) return true;
  if (typeof args !== "object" || args === null) return false;
  return Object.entries(expected).every(
    ([key, want]) => Reflect.get(args, key) === want,
  );
}

/**
 * Routes a stream fixture's commands to scripted answers, so a control in a
 * scene is followed by the craft's state changing through the stream rather than
 * by a local flip. A command with no matching case is answered with nothing,
 * as the stub does without a handler. Returns a function that cancels answers
 * still waiting on their delay.
 */
export function installCommandAnswers(
  target: AnswerTarget,
  answers: CommandAnswers,
): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  target.transport.setCommandHandler((command, args) => {
    const hit = answers[command]?.find((c) => matches(c.args, args));
    if (!hit) return undefined;
    const land = () => {
      for (const e of hit.emits) target.emit(e.channel, e.value, e.meta);
    };
    if (!hit.afterMs) {
      land();
    } else {
      const timer = setTimeout(() => {
        timers.delete(timer);
        land();
      }, hit.afterMs);
      timers.add(timer);
    }
    return { ok: true };
  });
  return () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
