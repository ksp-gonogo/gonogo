import { type GameFacts, PeerClientService } from "./PeerClientService";

/** How long a look-up waits for the host to answer before it reports no game. */
export const LOOKUP_TIMEOUT_MS = 20_000;

/** A look-up's answer: the host's facts, or no game on that code. */
export type LookupResult =
  | { kind: "found"; facts: GameFacts }
  | { kind: "none" };

/**
 * Ask the host under `code` what its join cards show, without joining. A code
 * nobody holds, or a host that does not answer within `timeoutMs`, is no game.
 * `signal` abandons the look-up, which then never settles.
 */
export function lookupGame(
  code: string,
  {
    timeoutMs = LOOKUP_TIMEOUT_MS,
    signal,
    makeClient = () => new PeerClientService({ lookupOnly: true }),
  }: {
    timeoutMs?: number;
    signal?: AbortSignal;
    makeClient?: () => PeerClientService;
  } = {},
): Promise<LookupResult> {
  return new Promise((resolve) => {
    const client = makeClient();
    let done = false;
    const finish = (result: LookupResult | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const off of offs) off();
      client.disconnect();
      if (result) resolve(result);
    };
    const timer = setTimeout(() => finish({ kind: "none" }), timeoutMs);
    const offs = [
      client.onGameFacts((facts) => finish({ kind: "found", facts })),
      client.onHostUnavailable(() => finish({ kind: "none" })),
      client.onHostChannelFailed((failed) => {
        if (failed) finish({ kind: "none" });
      }),
    ];
    signal?.addEventListener("abort", () => finish(null), { once: true });
    client.connect(code);
  });
}
