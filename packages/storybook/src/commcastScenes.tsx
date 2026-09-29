import "./appWidgets";
import { ScreenProvider } from "@ksp-gonogo/core";
import { type ReactNode, useMemo } from "react";
import { CommcastLog } from "../../app/src/commcast/CommcastLog";
import { CommcastLogProvider } from "../../app/src/commcast/CommcastLogContext";
import { RadioBackendProvider } from "../../app/src/commcast/radio/backend";
import { clipRadio, SHORT_CLIP } from "../../app/src/commcast/radio/clips";
import type { CommsAck, CommsMessage } from "../../app/src/commcast/types";
import {
  StationIdentityProvider,
  StationIdentityService,
} from "../../app/src/stationIdentity";
import { AppWidgetScene, type ScenePress } from "./AppWidgetScene";

/** The UT every scene calls now: message instants are offsets from it. */
const VIEW_UT = 12_000_000;

export const KSC = "ground:kennedy";
export const ARES = "vessel:ares-4";
export const WOOMERA = "ground:woomera";
export const RECOVERY = "ground:recovery";

/** Four minutes each way between the ground and the craft. */
export const LIGHT_TIME = 240;

/** Every ordered pair among the four vantages, one-way seconds. */
export const PAIRS = [
  { from: KSC, to: KSC, oneWaySeconds: 0 },
  { from: ARES, to: ARES, oneWaySeconds: 0 },
  { from: KSC, to: ARES, oneWaySeconds: LIGHT_TIME },
  { from: ARES, to: KSC, oneWaySeconds: LIGHT_TIME },
  { from: KSC, to: WOOMERA, oneWaySeconds: 12 },
  { from: WOOMERA, to: KSC, oneWaySeconds: 12 },
  { from: ARES, to: WOOMERA, oneWaySeconds: LIGHT_TIME },
  { from: WOOMERA, to: ARES, oneWaySeconds: LIGHT_TIME },
  { from: KSC, to: RECOVERY, oneWaySeconds: 0.4 },
  { from: RECOVERY, to: KSC, oneWaySeconds: 0.4 },
];

export const ROSTER = [
  { id: KSC, displayName: "Kennedy", active: true, isHome: true },
  { id: ARES, displayName: "Ares 4", active: true, isHome: false },
  { id: WOOMERA, displayName: "Woomera Range", active: true, isHome: false },
  { id: RECOVERY, displayName: "Recovery 1", active: true, isHome: false },
];

/** One message a scene's log holds, in whichever direction. */
export interface Held {
  from: string;
  to: string[];
  authorName: string;
  authorSeat: "pilot" | "mission-control";
  body: string;
  /** Seconds relative to now; negative is in the past. */
  sentAt: number;
  /** Relative to now. Defaults to `sentAt`, and differs after a resend. */
  lastSentAt?: number;
  attempts?: number;
  /** The author-to-recipient separation frozen at send. `null` is no path. */
  separationSeconds: number | null;
  /** Acknowledgements this log has received, each at the recipient's own instant. */
  acks?: { from: string; stationKey: string; at: number }[];
  /** An outbound message that was never transmitted. */
  neverLeft?: boolean;
  /** The group it is addressed to. Defaults to one group per set of ends. */
  group?: string;
  /** A membership change rather than words: the members after it, and who it brought in. */
  members?: string[];
  added?: string[];
}

export interface CommcastSceneProps {
  seat: "mission-control" | "pilot";
  /** The vantage this screen's frames are delayed from. */
  vantage: string;
  /** What this screen posts as. */
  name: string;
  sent?: Held[];
  received?: Held[];
  /** Addressed here and still crossing, so shown nowhere yet. */
  crossing?: Held[];
  /** The path home `comms.delay` carries, one-way seconds. */
  oneWaySeconds?: number;
  /** Publish the link as confirmed lost, so the log ends at its no-signal marker. */
  linkLost?: boolean;
  /** Controls pressed once mounted, to reach a thread or the picker. */
  presses?: readonly ScenePress[];
  w: number;
  h: number;
}

let nextId = 0;

function toMessage(held: Held): CommsMessage {
  nextId += 1;
  const ends = [...new Set([held.from, ...held.to])].sort();
  const base = {
    id: `story-${nextId}`,
    groupId: held.group ?? JSON.stringify(ends),
    to: ends,
    from: held.from,
    authorStationKey: `author-${held.from}`,
    authorName: held.authorName,
    authorSeat: held.authorSeat,
    sentUt: VIEW_UT + held.sentAt,
    lastSentUt: VIEW_UT + (held.lastSentAt ?? held.sentAt),
    attempts: held.attempts ?? 1,
    separationSeconds: held.separationSeconds,
  };
  if (held.members === undefined) {
    return { ...base, kind: "text", body: held.body };
  }
  return {
    ...base,
    kind: "members",
    members: held.members,
    added: held.added ?? [],
  };
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

function seededLog(props: CommcastSceneProps): CommcastLog {
  const log = new CommcastLog({
    screenKey: `story-${props.vantage}`,
    storage: memoryStorage(),
  });
  log.setVantage(props.vantage);
  log.replaceForTesting({
    outbox: (props.sent ?? []).map((held) => {
      const msg = toMessage(held);
      const acks: CommsAck[] = (held.acks ?? []).map((a) => ({
        messageId: msg.id,
        from: a.from,
        stationKey: a.stationKey,
        seat: a.from.startsWith("vessel:") ? "pilot" : "mission-control",
        atUt: VIEW_UT + a.at,
      }));
      return { msg, acks, neverLeft: held.neverLeft === true };
    }),
    inbox: (props.received ?? []).map(toMessage),
    pending: (props.crossing ?? []).map(toMessage),
  });
  return log;
}

/**
 * The stream a Commcast screen reads, stamped as seen from `vantage`. Left on
 * the live clock rather than pinned: the log releases an arrival by comparing
 * its instant against the clock's running estimate, which a pinned clock never
 * advances.
 */
function sceneStream(props: CommcastSceneProps): Record<string, unknown> {
  const meta = {
    validAt: VIEW_UT,
    deliveredAt: VIEW_UT,
    vantage: props.vantage,
  };
  const emits: { channel: string; value: unknown; meta: typeof meta }[] = [
    { channel: "commandCentre.separation", value: { pairs: PAIRS }, meta },
    { channel: "commandCentre.roster", value: ROSTER, meta },
    {
      channel: "comms.link",
      value: { connected: props.linkLost !== true },
      meta,
    },
  ];
  if (props.oneWaySeconds !== undefined) {
    emits.unshift({
      channel: "comms.delay",
      value: { oneWaySeconds: props.oneWaySeconds },
      meta,
    });
  }
  return { _stream: { emits } };
}

/**
 * The Commcast widget on one vantage's own log, seeded with what that vantage
 * sent and what has reached it, then driven to the view the scene is about.
 * The radio runs on a recorded clip, so nothing asks for a microphone.
 */
export function CommcastScene(props: CommcastSceneProps) {
  const fixture = useMemo(() => sceneStream(props), [props]);
  const wrap = useMemo(() => {
    const log = seededLog(props);
    const identity = new StationIdentityService(memoryStorage(), props.name);
    const radio = clipRadio(SHORT_CLIP);
    const screen = props.seat === "pilot" ? "pilot" : "main";
    return (tree: ReactNode) => (
      <ScreenProvider value={screen}>
        <StationIdentityProvider service={identity}>
          <RadioBackendProvider value={radio.backend}>
            <CommcastLogProvider log={log}>{tree}</CommcastLogProvider>
          </RadioBackendProvider>
        </StationIdentityProvider>
      </ScreenProvider>
    );
  }, [props]);
  return (
    <AppWidgetScene
      widgetId="commcast"
      fixture={fixture}
      w={props.w}
      h={props.h}
      wrap={wrap}
      presses={props.presses}
    />
  );
}

/** From the ground to the craft. */
export const toAres = (body: string, sentAt: number): Held => ({
  from: KSC,
  to: [ARES],
  authorName: "Kennedy Flight",
  authorSeat: "mission-control",
  body,
  sentAt,
  separationSeconds: LIGHT_TIME,
});

/** From the craft to the ground. */
export const toKsc = (body: string, sentAt: number): Held => ({
  from: ARES,
  to: [KSC],
  authorName: "Jeb",
  authorSeat: "pilot",
  body,
  sentAt,
  separationSeconds: LIGHT_TIME,
});

/** The crew's acknowledgement, at the instant the message reached them. */
export const ackedByAres = (sentAt: number) => [
  { from: ARES, stationKey: "pilot-1", at: sentAt + LIGHT_TIME },
];

/** The ground's acknowledgement, at the instant the message reached it. */
export const ackedByKsc = (sentAt: number) => [
  { from: KSC, stationKey: "ksc-1", at: sentAt + LIGHT_TIME },
];

/** A list row, never a header control that happens to carry the same words. */
export const ROW = "button[aria-pressed]";
