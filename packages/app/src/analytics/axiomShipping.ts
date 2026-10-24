import { useSyncExternalStore } from "react";

/**
 * Whether this screen can ship logs to Axiom, and whether the last delivery
 * worked. `"no-token"` means the build carries no ingest token, so switching
 * analytics on installs nothing; `"failing"` means the SDK reported an ingest
 * error since the transport was installed.
 */
export type AxiomShipping = "ready" | "no-token" | "failing";

let failing = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function hasAxiomToken(): boolean {
  return Boolean(import.meta.env.VITE_AXIOM_TOKEN);
}

/** Records a failed ingest from the installed transport. */
export function reportAxiomDeliveryFailure(): void {
  if (failing) return;
  failing = true;
  notify();
}

/** Clears the failure record when a transport is installed afresh. */
export function resetAxiomDeliveryFailure(): void {
  if (!failing) return;
  failing = false;
  notify();
}

export function axiomShipping(): AxiomShipping {
  if (!hasAxiomToken()) return "no-token";
  return failing ? "failing" : "ready";
}

/** The shipping state, for a settings row that tells the operator when analytics is on but nothing leaves this screen. */
export function useAxiomShipping(): AxiomShipping {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, axiomShipping);
}
