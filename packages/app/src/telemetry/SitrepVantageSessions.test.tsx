import type { ServerMessage, StreamData } from "@ksp-gonogo/sitrep-sdk";
import { makeMeta } from "@ksp-gonogo/sitrep-sdk/testing";
import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import type { PeerMessage } from "../peer/protocol";
import {
  type OpenVantageSession,
  SitrepVantageSessions,
  type VantageSession,
  type VantageSessionHost,
} from "./SitrepVantageSessions";

/** A stream frame the component will actually recognise, envelope and all. */
function frame(topic: string): StreamData<unknown> {
  return { type: "stream-data", topic, payload: {}, meta: makeMeta() };
}

const CRAFT = "vessel:abc-123";
const RELAY = "vessel:relay-777";

/**
 * A session that records what was asked of it instead of opening a socket,
 * through the component's own `openSession` seam.
 */
function makeSessions() {
  const opened: string[] = [];
  const disposed: string[] = [];
  const live = new Map<string, Set<string>>();
  const frameListeners = new Map<string, (m: ServerMessage) => void>();

  const openSession: OpenVantageSession = (vantage) => {
    opened.push(vantage);
    const topics = new Set<string>();
    live.set(vantage, topics);
    const session: VantageSession = {
      subscribe: (topic) => {
        topics.add(topic);
        return () => topics.delete(topic);
      },
      onRawMessage: (cb) => {
        frameListeners.set(vantage, cb);
        return () => frameListeners.delete(vantage);
      },
      dispose: () => {
        disposed.push(vantage);
      },
    };
    return session;
  };

  return { opened, disposed, live, frameListeners, openSession };
}

/** The slice of the host this component actually touches. */
function makeHost() {
  const sinks = new Map<
    string,
    {
      subscribe(topic: string): () => void;
      cachedFrame(topic: string): unknown;
    }
  >();
  const sent: Array<{ vantage: string; msg: PeerMessage }> = [];
  let announce: ((v: readonly string[]) => void) | undefined;

  const host: VantageSessionHost = {
    onRequestedVantagesChanged: (cb: (v: readonly string[]) => void) => {
      announce = cb;
      cb([]); // the replay-on-subscribe the real one does
      return () => {
        announce = undefined;
      };
    },
    attachSitrepSinkFor: (vantage, sink) => {
      sinks.set(vantage, sink);
      return () => sinks.delete(vantage);
    },
    broadcastToVantage: (vantage, msg) => {
      sent.push({ vantage, msg });
    },
  };

  return {
    host,
    sinks,
    sent,
    want: (vantages: readonly string[]) => announce?.(vantages),
  };
}

function mount() {
  const sessions = makeSessions();
  const host = makeHost();
  const view = render(
    <SitrepVantageSessions
      peerHost={host.host}
      openSession={sessions.openSession}
    />,
  );
  return { ...sessions, ...host, view };
}

describe("SitrepVantageSessions", () => {
  it("opens nothing until a peer asks for a vantage", () => {
    // Every session with no remote pilot in it pays nothing, which is most of
    // them.
    const f = mount();

    expect(f.opened).toEqual([]);

    f.view.unmount();
  });

  it("opens one session per vantage asked for", () => {
    const f = mount();

    f.want([CRAFT, RELAY]);

    expect(f.opened).toEqual([CRAFT, RELAY]);
    expect(f.sinks.has(CRAFT)).toBe(true);
    expect(f.sinks.has(RELAY)).toBe(true);

    f.view.unmount();
  });

  it("KEEPS a session that is still wanted when another comes or goes", () => {
    /*
     * Rebuilding every session on each change would drop a pilot's socket
     * whenever an unrelated peer arrived, which is a blank instrument panel
     * for a reason that has nothing to do with them.
     */
    const f = mount();
    f.want([CRAFT]);
    expect(f.opened).toEqual([CRAFT]);

    f.want([CRAFT, RELAY]);

    expect(f.opened).toEqual([CRAFT, RELAY]);
    expect(f.disposed).toEqual([]);

    f.view.unmount();
  });

  it("closes the session for a vantage nobody reads from any more", () => {
    const f = mount();
    f.want([CRAFT, RELAY]);

    f.want([CRAFT]);

    expect(f.disposed).toEqual([RELAY]);
    expect(f.sinks.has(RELAY)).toBe(false);
    expect(f.sinks.has(CRAFT)).toBe(true);

    f.view.unmount();
  });

  it("subscribes a topic on the session for its own vantage", () => {
    const f = mount();
    f.want([CRAFT, RELAY]);

    f.sinks.get(CRAFT)?.subscribe("vessel.orbit");

    expect([...(f.live.get(CRAFT) ?? [])]).toEqual(["vessel.orbit"]);
    expect([...(f.live.get(RELAY) ?? [])]).toEqual([]);

    f.view.unmount();
  });

  it("sends a session's frames only to the peers at that vantage", () => {
    const f = mount();
    f.want([CRAFT, RELAY]);

    f.frameListeners.get(CRAFT)?.(frame("vessel.orbit"));

    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.vantage).toBe(CRAFT);

    f.view.unmount();
  });

  it("answers a late subscriber from the cache, so a low-rate topic is not blank until it next changes", () => {
    const f = mount();
    f.want([CRAFT]);
    f.frameListeners.get(CRAFT)?.(frame("vessel.orbit"));

    expect(f.sinks.get(CRAFT)?.cachedFrame("vessel.orbit")).toBeDefined();
    expect(f.sinks.get(CRAFT)?.cachedFrame("vessel.flight")).toBeUndefined();

    f.view.unmount();
  });

  it("closes every session on unmount, so a torn-down host leaves no socket open", () => {
    const f = mount();
    f.want([CRAFT, RELAY]);

    f.view.unmount();

    expect(f.disposed.sort()).toEqual([CRAFT, RELAY].sort());
  });
});
