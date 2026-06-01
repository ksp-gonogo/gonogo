import { logger } from "@gonogo/logger";
import type Peer from "peerjs";
import {
  type DirectoryResolveResponse,
  directoryPeerId,
} from "./directoryProtocol";

/**
 * ICE server configuration for the host's PeerJS Peer.
 *
 * The gonogo relay hosts a coturn TURN server bundled in its container,
 * with a per-restart-rotated secret minted in-memory. The host (main
 * screen) fetches `/ice-config` once on boot to learn the credentials
 * and the public IP coturn is advertising.
 *
 * Stations don't fetch this themselves: their host's relay candidates
 * propagate via the broker's signalling channel, which is enough for
 * one-side TURN to bridge any difficult network. We deliberately
 * construct station Peers with no `iceServers` config so a stale or
 * absent local default can't sabotage that path (we used to default to
 * `turn:localhost:3478`, which from a phone meant the phone itself —
 * four useless STUN/TURN timeouts per attempt).
 */

export interface IceConfig {
  iceServers: RTCIceServer[];
}

const DEFAULT_RELAY_URL = "http://localhost:3002";
const FETCH_TIMEOUT_MS = 4_000;

/**
 * Fetch the host's ICE config from the relay's `/ice-config` endpoint.
 * Returns `[]` if the fetch fails — the host falls back to direct +
 * STUN-only behaviour, and the readiness UI surfaces the failure.
 */
export async function fetchHostIceServers(): Promise<RTCIceServer[]> {
  const url = relayBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/ice-config`, { signal: controller.signal });
    if (!res.ok) {
      logger.warn(`[ice] relay /ice-config returned ${res.status}`);
      return [];
    }
    const body = (await res.json()) as IceConfig;
    if (!Array.isArray(body.iceServers)) {
      logger.warn("[ice] relay /ice-config response missing iceServers");
      return [];
    }
    return body.iceServers;
  } catch (err) {
    logger.warn(
      `[ice] relay /ice-config fetch failed — host will run without TURN (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the main screen looks for the relay. Defaults to the
 * dev-compose port on the same machine. Override via `VITE_RELAY_URL`
 * for setups where the relay is on a different host.
 */
export function relayBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env.VITE_RELAY_URL ?? DEFAULT_RELAY_URL).replace(/\/$/, "");
}

/** How long to wait for the directory peer to answer before giving up and
 *  falling back to a direct connect. The round-trip is one broker-brokered
 *  DataConnection open + a single small message each way; 4s is generous
 *  for a healthy broker and short enough not to stall reconnects when the
 *  relay isn't running. */
const DIRECTORY_RESOLVE_TIMEOUT_MS = 4_000;

/**
 * Resolve a host share-code to its current PeerJS peer id via the relay's
 * **broker-side directory peer** (`gonogo-dir-<shareCode>`). Returns the
 * peer id, or `null` when the directory peer is unreachable (relay down,
 * timeout) or replies `not-found` — the station then falls back to
 * treating the typed value as a direct peer id (back-compat with the
 * no-relay flow).
 *
 * Unlike the old HTTP `GET /host/:shareCode` lookup, this works across
 * machines: the only rendezvous a station and the host's relay both reach
 * is the PeerJS broker, so the directory is exposed *through* the broker.
 * The relay registers itself as `gonogo-dir-<shareCode>` (stable, because
 * the relay process never reloads) and answers a `resolve` request with
 * the host's current peer id.
 *
 * The host re-registers `shareCode → peerId` with its relay on every
 * PeerJS open + heartbeat, so a station re-resolving on each reconnect
 * auto-follows the host's peer-id rotation without the operator re-sharing
 * a code.
 *
 * `peer` is this station's already-open Peer — reused for the directory
 * round-trip so we don't stand up a second broker session per reconnect.
 */
export function resolveHostPeerId(
  shareCode: string,
  peer: Peer,
): Promise<string | null> {
  const targetId = directoryPeerId(shareCode);
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (peerId: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn.close();
      } catch {
        /* already closed */
      }
      resolve(peerId);
    };

    const timer = setTimeout(() => {
      logger.debug(
        `[ice] directory ${targetId} did not answer in ${DIRECTORY_RESOLVE_TIMEOUT_MS}ms — treating code as a direct peer id`,
      );
      finish(null);
    }, DIRECTORY_RESOLVE_TIMEOUT_MS);

    // Open a one-shot DataConnection to the directory peer. `peer.connect`
    // can return undefined if the broker session has dropped — guard it.
    const conn = peer.connect(targetId);
    if (!conn) {
      logger.debug(
        `[ice] could not open a directory connection to ${targetId} (broker session down?) — falling back to direct peer id`,
      );
      finish(null);
      return;
    }

    conn.on("open", () => {
      conn.send({ type: "resolve" });
    });
    conn.on("data", (raw) => {
      const msg = raw as DirectoryResolveResponse;
      if (msg?.type === "host" && typeof msg.peerId === "string") {
        finish(msg.peerId);
      } else {
        // not-found (or anything unexpected) → fall back to direct.
        logger.debug(
          `[ice] directory ${targetId} reports no host for ${shareCode}`,
        );
        finish(null);
      }
    });
    conn.on("error", () => {
      // peer-unavailable etc. — directory not on the broker. The Peer-level
      // error handler in PeerClientService swallows the matching
      // peer-unavailable during the resolve window; here we just fail soft.
      finish(null);
    });
    conn.on("close", () => {
      // Closed before we got an answer → fail soft (direct fallback).
      finish(null);
    });
  });
}
