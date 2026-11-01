/**
 * The game's host record, as a fake mod keeps it for the screens a spec opens:
 * one holder at a time, a claim by the holder's own token taken as a reload,
 * the code and the approved stations open only to the holder.
 *
 * One record per server process, shared by every port it serves, because a
 * local screen hosts or joins by what the game says and the screens of one
 * spec must find each other. Specs run one at a time, and a holder whose
 * socket closes is let go at once rather than after a grace, so the next spec
 * starts with the role free.
 *
 * The credential every seeded station presents (`seedApprovedStation` in
 * `helpers.ts`) is approved from the start, as a save that had approved it.
 */

const HEARTBEAT_SECONDS = 5;
const GRACE_SECONDS = 15;
export const E2E_JOIN_CODE = "E2E234";
export const E2E_STATION_CREDENTIAL = "e2e0station0credential0000000000";

function idOf(secret) {
  let hash = 0;
  for (const ch of secret) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `id${hash.toString(36)}`;
}

/**
 * Build the record. `send(ws, frame)` writes one frame to a socket, and
 * `meta()` gives the `Meta` a frame from this server carries.
 */
export function createHostRecord({ send, meta }) {
  let holderToken = null;
  let holderSocket = null;
  let deadline = 0;
  let code = E2E_JOIN_CODE;
  const stations = new Map([
    [
      E2E_STATION_CREDENTIAL,
      { id: idOf(E2E_STATION_CREDENTIAL), name: "E2E", approvedAt: 0 },
    ],
  ]);
  const subscribers = new Set();

  const record = () => ({
    held: holderToken !== null,
    holderAway: false,
    holderId: holderToken ? idOf(holderToken) : "",
    code,
    stations: [...stations.values()],
  });

  const frame = () => ({
    type: "stream-data",
    topic: "host.record",
    payload: record(),
    meta: meta(),
  });

  const publish = () => {
    for (const ws of subscribers) {
      if (ws.readyState === ws.OPEN) send(ws, frame());
    }
  };

  const expire = () => {
    if (holderToken === null || Date.now() < deadline) return;
    holderToken = null;
    holderSocket = null;
    publish();
  };
  const expiry = setInterval(expire, 1000);
  expiry.unref?.();

  /* Counts the grants, as the mod does. */
  let generation = 0;
  const roleReply = (holds) => ({
    success: true,
    payload: {
      holds,
      holderId: holderToken ? idOf(holderToken) : "",
      heartbeatSeconds: HEARTBEAT_SECONDS,
      graceSeconds: GRACE_SECONDS,
      generation,
    },
  });
  const refused = {
    success: false,
    errorCode: "wrongState",
    reason: "only the screen that holds the host role can do that",
  };

  function take(token, ws) {
    const changed = holderToken !== token;
    holderToken = token;
    holderSocket = ws;
    deadline = Date.now() + GRACE_SECONDS * 1000;
    if (changed) publish();
  }

  function answer(ws, command, args) {
    expire();
    const token = typeof args?.token === "string" ? args.token : "";
    const holds = token !== "" && token === holderToken;
    switch (command) {
      case "host.claim":
        if (holderToken !== null && !holds) return roleReply(false);
        generation += 1;
        take(token, ws);
        return roleReply(true);
      case "host.heartbeat":
        if (!holds) return roleReply(false);
        take(token, ws);
        return roleReply(true);
      case "host.release":
        if (!holds) return refused;
        holderToken = null;
        holderSocket = null;
        publish();
        return { success: true };
      case "host.code.regenerate":
        if (!holds) return refused;
        code = code === E2E_JOIN_CODE ? "E2E567" : E2E_JOIN_CODE;
        publish();
        return { success: true };
      case "host.station.approve": {
        if (!holds) return refused;
        const credential = String(args.credential ?? "");
        const existing = stations.get(credential);
        stations.set(credential, {
          id: idOf(credential),
          name: String(args.name ?? ""),
          approvedAt: existing?.approvedAt ?? Date.now(),
        });
        publish();
        return { success: true };
      }
      case "host.station.revoke":
        if (!holds) return refused;
        for (const [credential, station] of stations) {
          if (station.id === args.stationId) stations.delete(credential);
        }
        publish();
        return { success: true };
      case "host.station.check": {
        if (!holds) return refused;
        const station = stations.get(String(args.credential ?? ""));
        return {
          success: true,
          payload: {
            approved: station !== undefined,
            stationId: station?.id ?? "",
            name: station?.name ?? "",
          },
        };
      }
      default:
        return undefined;
    }
  }

  return {
    /**
     * Handle one client message on `ws` if it concerns the host record.
     * Returns true when it did, so the server passes on everything else.
     */
    handle(ws, data) {
      if (data?.type === "subscribe" && data.topic === "host.record") {
        subscribers.add(ws);
        send(ws, frame());
        return true;
      }
      if (data?.type === "unsubscribe" && data.topic === "host.record") {
        subscribers.delete(ws);
        return true;
      }
      if (
        data?.type !== "command-request" ||
        typeof data.command !== "string" ||
        !data.command.startsWith("host.")
      ) {
        return false;
      }
      const result = answer(ws, data.command, data.args);
      if (result === undefined) return false;
      send(ws, {
        type: "command-response",
        requestId: data.requestId,
        result,
        meta: meta(),
      });
      return true;
    },

    /** A socket closed: a holder that goes lets the role go at once. */
    closed(ws) {
      subscribers.delete(ws);
      if (holderSocket !== ws) return;
      holderToken = null;
      holderSocket = null;
      publish();
    },
  };
}
