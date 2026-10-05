import { useCallback, useEffect, useState } from "react";
import { relayBaseUrl } from "../peer/iceServers";

const FETCH_TIMEOUT_MS = 4_000;
/** How often an unanswered relay is asked again, so starting the container is noticed without a click. */
const RETRY_MS = 3_000;

/**
 * Whether the relay half of the container answers. `checking` only until the
 * first answer or failure lands: a retry after that keeps the last reading on
 * screen rather than flickering back to a question.
 */
export type RelayHealth = "checking" | "ok" | "unreachable";

export interface UseRelayHealthResult {
  health: RelayHealth;
  /** Ask again now, for an operator who has just started the container. */
  recheck: () => void;
}

async function relayAnswers(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${relayBaseUrl()}/health`, { signal });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return (
      typeof body === "object" &&
      body !== null &&
      Reflect.get(body, "status") === "ok"
    );
  } catch {
    return false;
  }
}

/**
 * Asks the relay's `/health` on mount and keeps asking while it does not
 * answer. It stops once the relay is up: the wizard needs to know the
 * container started, not to monitor it.
 */
export function useRelayHealth(): UseRelayHealthResult {
  const [health, setHealth] = useState<RelayHealth>("checking");
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger, read by nothing in the body.
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let retry: ReturnType<typeof setTimeout> | undefined;
    let live = true;

    void relayAnswers(controller.signal).then((ok) => {
      clearTimeout(timeout);
      if (!live) return;
      setHealth(ok ? "ok" : "unreachable");
      if (!ok) retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
    });

    return () => {
      live = false;
      clearTimeout(timeout);
      clearTimeout(retry);
      controller.abort();
    };
  }, [attempt]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  return { health, recheck };
}
