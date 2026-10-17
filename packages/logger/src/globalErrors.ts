import type { Logger } from "./types.js";

/** One error repeating inside this window is counted, not logged again, so a throw in an animation frame cannot flood the log. */
const REPEAT_WINDOW_MS = 10_000;
const MAX_TRACKED = 200;

/*
 * The browser raises this when a ResizeObserver callback changes layout it
 * then has to observe again. It is benign by specification and fires on
 * ordinary window resizes, so logging it would bury the real errors.
 */
const BENIGN = /^ResizeObserver loop/;

/** A field of the error or rejection event, read without assuming which of the two arrived. */
function field(event: Event, name: string): unknown {
  return Reflect.get(event, name);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  if (value === undefined || value === null) return new Error(fallback);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

/**
 * Logs every error nothing else caught: a throw in an event handler, timer or
 * script (the `error` event) and a promise rejected with no handler
 * (`unhandledrejection`). Both arrive as `error` entries tagged `uncaught`,
 * with the thrown error's name, message and stack. One error repeating
 * within ten seconds is logged once, and the next entry for it carries how
 * many were held back in `context.repeats`. Returns a function that removes
 * both listeners.
 */
export function installGlobalErrorHooks(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  log: Logger,
  now: () => number = Date.now,
): () => void {
  const uncaught = log.tag("uncaught");
  const seen = new Map<string, { at: number; held: number }>();

  const report = (
    kind: "error" | "unhandled rejection",
    error: Error,
    context: Record<string, unknown>,
  ) => {
    if (BENIGN.test(error.message)) return;
    const key = `${kind}|${error.name}|${error.message}|${error.stack?.split("\n", 2)[1] ?? ""}`;
    const t = now();
    const prior = seen.get(key);
    if (prior && t - prior.at < REPEAT_WINDOW_MS) {
      prior.held++;
      return;
    }
    if (seen.size >= MAX_TRACKED) seen.clear();
    seen.set(key, { at: t, held: 0 });
    const repeats = prior?.held ?? 0;
    uncaught.error(`${kind}: ${error.message}`, error, {
      kind,
      ...context,
      ...(repeats > 0 ? { repeats } : {}),
    });
  };

  const onError = (event: Event) => {
    const message = text(field(event, "message")) ?? "script error";
    report("error", asError(field(event, "error"), message), {
      source: text(field(event, "filename")),
      line: count(field(event, "lineno")),
      column: count(field(event, "colno")),
    });
  };
  const onRejection = (event: Event) => {
    report(
      "unhandled rejection",
      asError(field(event, "reason"), "rejected with no reason"),
      {},
    );
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
