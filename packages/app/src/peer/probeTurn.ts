import { logger } from "@ksp-gonogo/logger";

/**
 * STUN/TURN reachability probe for the main screen.
 *
 * The user's most painful failure mode is "TURN looks configured but
 * isn't actually reachable from the public internet" — usually a
 * missing port-forward on the home router. The proxy can't tell on its
 * own (it's *inside* the NAT). The browser is on the outside relative
 * to the relay's container, so it's the right place to check.
 *
 * Method: construct an `RTCPeerConnection` configured with the relay's
 * iceServers, kick off candidate gathering, and watch for a `relay`
 * candidate within a short timeout. Reaching one proves the browser
 * could allocate against TURN end-to-end. Timing out without one means
 * either coturn isn't reachable, the credentials are wrong, or the
 * external-ip coturn is advertising isn't routable from us.
 *
 * Runs once on boot, then on a slow interval — picks up router or
 * relay restarts without spam.
 */

const probeLog = logger.tag("peer:turn-probe");

export type TurnProbeResult =
  | { ok: true; relayCandidates: number; durationMs: number }
  | {
      ok: false;
      reason: "timeout" | "no-ice-servers" | "errored";
      durationMs: number;
      errors: Array<{ url: string; code: number; text: string }>;
    };

const DEFAULT_TIMEOUT_MS = 5_000;

export interface ProbeOptions {
  iceServers: RTCIceServer[];
  timeoutMs?: number;
}

/**
 * One-shot probe. Resolves with `ok: true` as soon as a relay candidate
 * is gathered, or with `ok: false` if the timeout fires first.
 */
export async function probeTurn(opts: ProbeOptions): Promise<TurnProbeResult> {
  const startedAt = Date.now();
  if (opts.iceServers.length === 0) {
    return { ok: false, reason: "no-ice-servers", durationMs: 0, errors: [] };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pc = new RTCPeerConnection({
    iceServers: opts.iceServers,
    // Force gathering to happen — without a transceiver or data
    // channel, ICE never starts.
    iceTransportPolicy: "all",
  });
  // A throwaway data channel is the cheapest way to force candidate
  // gathering. We don't actually open it.
  pc.createDataChannel("turn-probe");

  let relayCount = 0;
  const errors: Array<{ url: string; code: number; text: string }> = [];

  return new Promise<TurnProbeResult>((resolve) => {
    const settle = (result: TurnProbeResult) => {
      try {
        pc.close();
      } catch {
        // ignore — pc may already be closed
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      probeLog.debug("timed out waiting for relay candidate", {
        relayCount,
        errors: errors.length,
      });
      settle(
        relayCount > 0
          ? {
              ok: true,
              relayCandidates: relayCount,
              durationMs: Date.now() - startedAt,
            }
          : {
              ok: false,
              reason: "timeout",
              durationMs: Date.now() - startedAt,
              errors,
            },
      );
    }, timeoutMs);

    pc.addEventListener("icecandidate", (ev) => {
      const c = ev.candidate;
      if (!c) return; // end-of-candidates — let the timeout decide
      if (c.type === "relay") {
        relayCount += 1;
        clearTimeout(timer);
        settle({
          ok: true,
          relayCandidates: relayCount,
          durationMs: Date.now() - startedAt,
        });
      }
    });
    pc.addEventListener("icecandidateerror", (ev) => {
      const e = ev as RTCPeerConnectionIceErrorEvent;
      errors.push({ url: e.url, code: e.errorCode, text: e.errorText });
    });

    pc.createOffer({ iceRestart: false })
      .then((offer) => pc.setLocalDescription(offer))
      .catch((err) => {
        clearTimeout(timer);
        probeLog.warn("createOffer failed during probe", {
          err: err instanceof Error ? err.message : String(err),
        });
        settle({
          ok: false,
          reason: "errored",
          durationMs: Date.now() - startedAt,
          errors,
        });
      });
  });
}
