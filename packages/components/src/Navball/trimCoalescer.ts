import { useEffect, useRef } from "react";
import type { TrimField } from "./useNavballInputs";

/** One send per trim field per this many milliseconds, the same 10 Hz the axis streams run at. */
export const TRIM_COALESCE_MS = 100;

export interface TrimCoalescer {
  /** Records the newest value for a field and sends it now or at the end of the field's window. */
  push(field: TrimField, raw: number): void;
  /** Drops anything still waiting. */
  cancel(): void;
}

/**
 * Coalesces a stick's trim events, which arrive on every animation frame, to the newest value per field: the first goes at once, the rest wait for the end of the window and only the last of them is sent, so a sweep ends on the value the stick rests at.
 */
export function createTrimCoalescer(
  send: (field: TrimField, raw: number) => void,
): TrimCoalescer {
  const latest = new Map<TrimField, number>();
  const windows = new Map<TrimField, ReturnType<typeof setTimeout>>();

  /** Sends the field's waiting value and opens a window in which later ones wait. */
  function sendAndHold(field: TrimField): void {
    const raw = latest.get(field);
    if (raw === undefined) return;
    latest.delete(field);
    send(field, raw);
    windows.set(
      field,
      setTimeout(() => {
        windows.delete(field);
        sendAndHold(field);
      }, TRIM_COALESCE_MS),
    );
  }

  return {
    push(field, raw) {
      latest.set(field, raw);
      if (windows.has(field)) return;
      sendAndHold(field);
    },
    cancel() {
      for (const timer of windows.values()) clearTimeout(timer);
      windows.clear();
      latest.clear();
    },
  };
}

/** A stable trim sender that coalesces to the newest value per field and stops with the widget. */
export function useTrimSender(
  send: (field: TrimField, raw: number) => void,
): (field: TrimField, raw: number) => void {
  const sendRef = useRef(send);
  sendRef.current = send;
  const coalescer = useRef<TrimCoalescer | null>(null);
  if (coalescer.current === null) {
    coalescer.current = createTrimCoalescer((field, raw) =>
      sendRef.current(field, raw),
    );
  }
  useEffect(() => () => coalescer.current?.cancel(), []);
  return (field, raw) => coalescer.current?.push(field, raw);
}
