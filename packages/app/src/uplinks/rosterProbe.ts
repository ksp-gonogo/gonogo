// Boot-time roster probe (design §5 step 2) — the input that turns the loader's
// already-built three-way mod-hash check from stubbed to live.
//
// The loader runs pre-render, before `SitrepTelemetryProvider` mounts, so this
// opens a short-lived `TelemetryClient` + `WebSocketTransport`, awaits the first
// `system.uplinks` sample with a timeout, decodes it to `RosterEntry[]`, and
// disposes. It NEVER throws: no host, no sample in time, or a socket error all
// resolve `undefined`, and the loader degrades to the two-way index==bytes check
// with the mod-hash arm recorded as pending — the legitimate "no mod talking yet"
// state (a client half loading with no KSP connected is a valid shape).

import { logger } from "@ksp-gonogo/logger";
import {
  TelemetryClient,
  type Transport,
  WebSocketTransport,
} from "@ksp-gonogo/sitrep-client";
import { getSitrepHostConfig } from "../telemetry/sitrepRuntime";
import type { RosterEntry } from "./loader";

/** Raw `system.uplinks` wire entry (mirrors ChannelEngine.BuildSystemUplinksPayload). */
interface RawRosterEntry {
  id: string;
  version: string;
  available: boolean;
  reason: string | null;
  expectedClientHash?: string | null;
  health?: unknown;
}

export interface RosterProbeOptions {
  /** Inject a transport for tests; defaults to a live WebSocketTransport to the mod host/port. */
  transport?: Transport;
  /** Give up after this long with no sample and fall back to the two-way check. */
  timeoutMs?: number;
}

/**
 * Boot-time bounded read of the `system.uplinks` roster so the loader can enforce
 * the three-way mod-hash check. Never throws: any failure — no host, no sample in
 * time, socket error — resolves `undefined`.
 */
export async function probeUplinkRoster(
  opts: RosterProbeOptions = {},
): Promise<RosterEntry[] | undefined> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const { host, port } = getSitrepHostConfig();
  // Own (and dispose) only the transport we built — an injected one is the
  // caller's, matching SitrepTelemetryProvider's ownership convention.
  let ownedTransport: WebSocketTransport | undefined;
  let client: TelemetryClient | undefined;

  try {
    let transport: Transport;
    if (opts.transport) {
      transport = opts.transport;
    } else {
      ownedTransport = new WebSocketTransport({ host, port });
      transport = ownedTransport;
    }
    client = new TelemetryClient(transport);
    const activeClient = client;

    return await new Promise<RosterEntry[] | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs);
      const unsub = activeClient.subscribe(
        "system.uplinks",
        (value: unknown) => {
          if (value == null || typeof value !== "object") return; // tombstone / not-yet
          const payload = value as { uplinks?: RawRosterEntry[] };
          if (!Array.isArray(payload.uplinks)) return;
          clearTimeout(timer);
          unsub();
          resolve(
            payload.uplinks.map((e) => ({
              id: e.id,
              version: e.version,
              available: e.available,
              reason: e.reason ?? null,
              expectedClientHash: e.expectedClientHash ?? null,
            })),
          );
        },
      );
    });
  } catch (err) {
    logger.warn(
      `[uplink-loader] roster probe failed, using two-way fallback: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  } finally {
    client?.dispose();
    ownedTransport?.dispose();
  }
}
