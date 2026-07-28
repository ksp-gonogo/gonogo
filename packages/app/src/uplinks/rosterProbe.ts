// Boot-time roster probe (design §5 step 2), the input that turns the loader's
// already-built three-way mod-hash check from stubbed to live.
//
// The loader runs pre-render, before `SitrepTelemetryProvider` mounts, so this
// opens a short-lived `TelemetryClient` + `WebSocketTransport`, awaits the first
// `system.uplinks` sample with a timeout, decodes it to `RosterEntry[]`, and
// disposes. It NEVER throws: no host, no sample in time, or a socket error all
// resolve `undefined`, and the loader degrades to the two-way index==bytes check
// with the mod-hash arm recorded as pending, the legitimate "no mod talking yet"
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
  clientSource?: { url: string; devPath: string | null } | null;
  health?: unknown;
}

export interface RosterProbeOptions {
  /** Inject a transport for tests; defaults to a live WebSocketTransport to the mod host/port. */
  transport?: Transport;
  /** Give up after this long with no sample and fall back to the two-way check. */
  timeoutMs?: number;
}

/**
 * Decode a raw `system.uplinks` sample value into `RosterEntry[]`, or
 * `undefined` when the value isn't a valid roster payload (a tombstone/null,
 * a not-yet-arrived sticky read, or a malformed shape). Pure and side-effect
 * free so both boot-time consumers of the topic, `probeUplinkRoster` (the
 * main screen's own short-lived transport) and `readRosterFromTelemetryClient`
 * (the station's read off its already-connected peer client, D6/#6
 * follow-on): decode identically without duplicating the shape-guard logic.
 */
export function decodeRosterPayload(value: unknown): RosterEntry[] | undefined {
  if (value == null || typeof value !== "object") return undefined; // tombstone / not-yet
  const payload = value as { uplinks?: RawRosterEntry[] };
  if (!Array.isArray(payload.uplinks)) return undefined;
  return payload.uplinks.map((e) => ({
    id: e.id,
    version: e.version,
    available: e.available,
    reason: e.reason ?? null,
    expectedClientHash: e.expectedClientHash ?? null,
    // D5: carry the mod's client-source declaration through so it's
    // readable on RosterEntry. The loader/RegistrySource does not
    // consume it yet (separate follow-on); this only surfaces it.
    clientSource: e.clientSource ?? null,
  }));
}

/**
 * Boot-time bounded read of the `system.uplinks` roster so the loader can enforce
 * the three-way mod-hash check. Never throws: any failure, no host, no sample in
 * time, socket error: resolves `undefined`.
 */
export async function probeUplinkRoster(
  opts: RosterProbeOptions = {},
): Promise<RosterEntry[] | undefined> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const { host, port } = getSitrepHostConfig();
  // Own (and dispose) only the transport we built, an injected one is the
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
          const decoded = decodeRosterPayload(value);
          if (decoded === undefined) return;
          clearTimeout(timer);
          unsub();
          resolve(decoded);
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

/**
 * Station-side counterpart of `probeUplinkRoster` (#6, station boot
 * re-sequence): reads `system.uplinks` off an ALREADY-CONNECTED
 * `TelemetryClient` the caller borrows: never builds or disposes a
 * transport/client of its own. The main-screen probe above opens its own
 * short-lived `WebSocketTransport` straight to the mod, which is exactly the
 * direct-to-KSP connection a station is forbidden from making; a station
 * instead has a live peer-backed `TelemetryClient` already mounted (fed by
 * `SitrepPeerRelay` over PeerJS), and `system.uplinks` is in
 * `DEFAULT_SITREP_CARRIED_TOPICS`, so this only needs to subscribe to it.
 *
 * `SitrepPeerRelay` backfills the most recent frame to a newly-connecting
 * station, so the sticky value is often already cached on `client` by the
 * time this subscribes: `TelemetryClient.subscribe` invokes the callback
 * SYNCHRONOUSLY in that case, BEFORE `subscribe()` itself returns, which
 * means the `unsub` closure `subscribe()` is about to return isn't assigned
 * to anything yet at the moment that synchronous callback runs. A first cut
 * of this function declared `unsub` with `let` and a no-op default to dodge
 * the temporal-dead-zone crash that would otherwise cause, but that made
 * the synchronous-callback path call the STALE no-op instead of the real
 * unsubscribe closure, silently leaking the subscription (caught by this
 * file's own test suite: "leaves another subscriber's subscription intact"
 * expected the shared subscription to end up unsubscribed and it never
 * did). The `subscribeReturned` flag below fixes that properly: a callback
 * firing before `subscribe()` has returned stashes its result instead of
 * touching `unsub`; the couple of lines immediately after the `subscribe()`
 * call: where `unsub` IS safely assigned; pick that stash up and finish
 * there instead. A callback firing later (the ordinary case, no backfill
 * yet cached) always sees `subscribeReturned === true` and finishes
 * directly. The `probeUplinkRoster` case above never hits any of this
 * because its client is always freshly built with nothing cached yet.
 *
 * Never throws: no sample before `timeoutMs` resolves `undefined` (the
 * loader then falls back to the two-way index==bytes check, same as the
 * main screen's degraded-boot path). Always unsubscribes before resolving,
 * this is a one-shot borrow, not a standing subscription, and never calls
 * `client.dispose()`: the client is owned by `SitrepTelemetryProvider`, not
 * by this function.
 */
export async function readRosterFromTelemetryClient(
  client: TelemetryClient,
  timeoutMs = 3000,
): Promise<RosterEntry[] | undefined> {
  return new Promise<RosterEntry[] | undefined>((resolve) => {
    let settled = false;
    let subscribeReturned = false;
    let pendingSyncResult: RosterEntry[] | undefined;
    let gotPendingSync = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub();
      resolve(undefined);
    }, timeoutMs);

    const unsub = client.subscribe("system.uplinks", (value: unknown) => {
      if (settled) return;
      const decoded = decodeRosterPayload(value);
      if (decoded === undefined) return;
      if (!subscribeReturned) {
        // See the doc comment above: `unsub` isn't assigned yet, stash the
        // result for the code right after `subscribe()` returns to finish.
        gotPendingSync = true;
        pendingSyncResult = decoded;
        return;
      }
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve(decoded);
    });
    subscribeReturned = true;

    if (gotPendingSync && !settled) {
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve(pendingSyncResult);
    }
  });
}
