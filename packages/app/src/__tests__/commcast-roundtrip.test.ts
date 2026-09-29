/**
 * Three screens' logs, each on its own link, talking through a stand-in for the
 * mod that delivers what is said to its addressees one light-time later.
 *
 * The addressing and the timing are the mod's and are tested there, over a real
 * socket. What only shows end to end on this side is the round trip through the
 * link: words sent as commands come back as messages in someone else's log, an
 * acknowledgement crosses back to the author alone, and radio bytes survive the
 * batch they ride in.
 */
import type { Meta, ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { CommcastLog } from "../commcast/CommcastLog";
import {
  attachCommcastModLink,
  type CommcastWire,
} from "../commcast/CommcastModLink";
import type { HeardRadioFrame, RadioFrame } from "../commcast/radio/wire";
import { sentPhaseFor } from "../commcast/reveal";
import { EMPTY_COMMCAST_LOG } from "../commcast/types";

const KSC = "ksc";
const ARES = "vessel:ares";
const WOOMERA = "ground:woomera";
const LIGHT_TIME = 240;

/** One-way seconds between each pair; a vantage is no distance from itself. */
function delay(from: string, to: string): number {
  if (from === to) return 0;
  return [from, to].includes(ARES) ? LIGHT_TIME : 5;
}

/**
 * The mod, reduced to what the client can observe: every command is answered
 * at once, and what it says reaches each addressee `delay` later. Groups are
 * known to everyone at once here; who a speaker can see is the mod's rule and
 * is not what this file is about.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(a: Record<string, unknown>, key: string): string {
  const v = a[key];
  return typeof v === "string" ? v : "";
}

function strs(a: Record<string, unknown>, key: string): string[] {
  const v = a[key];
  return Array.isArray(v)
    ? v.filter((e): e is string => typeof e === "string")
    : [];
}

function fakeMod() {
  let now = 1000;
  const due: { at: number; to: string; message: ServerMessage }[] = [];
  const listeners = new Map<string, Set<(m: ServerMessage) => void>>();
  const groups = new Map<string, string[]>();
  const authors = new Map<string, string>();

  const meta = (validAt: number, deliveredAt: number, vantage: string): Meta =>
    ({
      source: "addressed",
      validAt,
      seq: 0,
      deliveredAt,
      vantage,
      quality: 0,
      active: true,
      staleness: 0,
      timelineEpoch: 0,
    }) as Meta;

  const say = (
    from: string,
    to: readonly string[],
    build: (m: Meta) => ServerMessage,
  ) => {
    for (const vantage of to) {
      const at = now + delay(from, vantage);
      due.push({ at, to: vantage, message: build(meta(now, at, vantage)) });
    }
  };

  const traffic = (from: string, to: readonly string[], item: object) =>
    say(
      from,
      to,
      (m): ServerMessage => ({
        type: "stream-data",
        topic: "commcast.traffic",
        meta: m,
        payload: { ...item, from, sentUt: now, to },
      }),
    );

  const handle = (
    from: string,
    command: string,
    a: Record<string, unknown>,
  ) => {
    const author = a.author;
    const groupId = str(a, "groupId");
    switch (command) {
      case "commcast.group.open": {
        const members = [...new Set([from, ...strs(a, "members")])];
        groups.set(groupId, members);
        traffic(from, members, {
          kind: "members",
          id: `${groupId}@${now}`,
          groupId,
          author,
          members,
          added: members,
        });
        return;
      }
      case "commcast.message.send": {
        const to = groups.get(groupId) ?? [];
        authors.set(str(a, "id"), from);
        traffic(from, to, {
          kind: "text",
          id: a.id,
          groupId: a.groupId,
          author,
          body: a.body,
        });
        return;
      }
      case "commcast.message.ack": {
        const author = authors.get(str(a, "messageId"));
        if (author)
          traffic(from, [author], {
            kind: "ack",
            groupId: "",
            author: a.author,
            messageId: a.messageId,
          });
        return;
      }
      case "commcast.radio.transmit": {
        const to = groups.get(groupId) ?? [];
        const head = new TextEncoder().encode(
          JSON.stringify({
            transmissionId: a.transmissionId,
            groupId: a.groupId,
            from,
            author,
            startedUt: now,
            seq: a.seq,
            end: a.end,
            to,
          }),
        );
        const chunks = strs(a, "chunks").map((c) =>
          Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0)),
        );
        say(
          from,
          to,
          (m): ServerMessage => ({
            type: "stream-binary",
            topic: "commcast.radio",
            meta: m,
            segments: [head, ...chunks],
          }),
        );
      }
    }
  };

  return {
    wireAt(vantage: string): CommcastWire {
      return {
        dispatch(command, args) {
          handle(vantage, command, isRecord(args) ? args : {});
          return { result: Promise.resolve({ success: true }) };
        },
        subscribe: () => () => {},
        onRawMessage(listener) {
          let set = listeners.get(vantage);
          if (!set) {
            set = new Set();
            listeners.set(vantage, set);
          }
          set.add(listener);
          return () => set?.delete(listener);
        },
      };
    },
    advanceTo(ut: number) {
      now = ut;
      for (const d of due.filter((x) => x.at <= ut)) {
        due.splice(due.indexOf(d), 1);
        for (const l of listeners.get(d.to) ?? []) l(d.message);
      }
    },
  };
}

const detachers: (() => void)[] = [];

afterEach(() => {
  for (const off of detachers.splice(0)) off();
  localStorage.clear();
});

function screen(mod: ReturnType<typeof fakeMod>, vantage: string, key: string) {
  const log = new CommcastLog({ screenKey: key, storage: undefined });
  log.setVantage(vantage);
  detachers.push(attachCommcastModLink(log, mod.wireAt(vantage)));
  const heard: HeardRadioFrame[] = [];
  log.onRadio((f) => heard.push(f));
  return { log, heard };
}

const FLIGHT = {
  stationKey: "ksc-1",
  name: "Kennedy Flight",
  seat: "mission-control" as const,
  vantageId: KSC,
};

function scene() {
  const mod = fakeMod();
  const ground = screen(mod, KSC, "ksc-1");
  const aboard = screen(mod, ARES, "pilot-1");
  const range = screen(mod, WOOMERA, "woomera-1");
  ground.log.send(FLIGHT, {
    kind: "members",
    groupId: "g1",
    to: [KSC, ARES],
    members: [KSC, ARES],
    added: [ARES],
    sentUt: 1000,
    separationSeconds: LIGHT_TIME,
  });
  return { mod, ground, aboard, range };
}

describe("Commcast through the mod", () => {
  it("reaches the members of the group one light-time later, and nobody else", () => {
    const { mod, ground, aboard, range } = scene();
    ground.log.send(FLIGHT, {
      kind: "text",
      groupId: "g1",
      body: "Go for the burn.",
      to: [KSC, ARES],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });

    mod.advanceTo(1239);
    expect(aboard.log.snapshot().pending).toHaveLength(0);
    mod.advanceTo(1240);
    const bodies = aboard.log.snapshot().pending.map((m) => m.body ?? m.kind);
    expect(bodies).toEqual(["members", "Go for the burn."]);
    expect(range.log.snapshot()).toEqual(EMPTY_COMMCAST_LOG);
  });

  it("does not hand the author its own words back", () => {
    const { mod, ground } = scene();
    ground.log.send(FLIGHT, {
      kind: "text",
      groupId: "g1",
      body: "hi",
      to: [KSC, ARES],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    mod.advanceTo(2000);
    expect(ground.log.snapshot().pending).toHaveLength(0);
    expect(ground.log.snapshot().outbox).toHaveLength(2);
  });

  it("confirms the author a full round trip after they spoke, and nobody else", () => {
    const { mod, ground, aboard, range } = scene();
    const msg = ground.log.send(FLIGHT, {
      kind: "text",
      groupId: "g1",
      body: "copy?",
      to: [KSC, ARES],
      sentUt: 1000,
      separationSeconds: LIGHT_TIME,
    });
    mod.advanceTo(1240);
    aboard.log.release(msg.id, {
      from: ARES,
      stationKey: "pilot-1",
      seat: "pilot",
    });

    const phaseAt = (ut: number) => {
      mod.advanceTo(ut);
      const out = ground.log.snapshot().outbox.find((o) => o.msg.id === msg.id);
      if (!out) throw new Error("the author's log lost its own message");
      return sentPhaseFor(out, ut);
    };
    expect(phaseAt(1479)).toBe("awaiting-reply");
    expect(phaseAt(1480)).toBe("confirmed");
    expect(range.log.snapshot()).toEqual(EMPTY_COMMCAST_LOG);
  });

  it("carries radio bytes through the batch untouched, and stores nothing", () => {
    const { mod, ground, aboard } = scene();
    const frame = (seq: number, bytes: number[]): RadioFrame => ({
      kind: "chunk",
      transmissionId: "t1",
      authorStationKey: "pilot-1",
      transmission: {
        id: "t1",
        groupId: "g1",
        from: ARES,
        authorStationKey: "pilot-1",
        authorName: "Jeb",
        authorSeat: "pilot",
        startedUt: 1300,
        separationSeconds: LIGHT_TIME,
      },
      to: [ARES, KSC],
      seq,
      ut: 1300,
      bytes: new Uint8Array(bytes),
    });
    mod.advanceTo(1300);
    aboard.log.sendRadio(frame(0, [0, 255, 128]));
    aboard.log.sendRadio({
      kind: "end",
      transmissionId: "t1",
      authorStationKey: "pilot-1",
      ut: 1300,
    });
    mod.advanceTo(1540);

    const landed = ground.heard.find((f) => f.kind === "chunk");
    if (landed?.kind !== "chunk")
      throw new Error("no chunk reached the ground");
    expect([...landed.bytes]).toEqual([0, 255, 128]);
    expect(landed.arrivedUt).toBe(1540);
    expect(aboard.heard).toHaveLength(0);
    expect(
      ground.log.snapshot().pending.filter((m) => m.kind !== "members"),
    ).toHaveLength(0);
  });
});
