import "./appWidgets";
import { ScreenProvider } from "@ksp-gonogo/core";
import { holdActiveTopicRead } from "@ksp-gonogo/sitrep-sdk/spine";
import { type ReactNode, useEffect, useMemo } from "react";
import { GoNoGoHostProvider } from "../../app/src/goNoGo/GoNoGoHostContext";
import {
  GoNoGoHostService,
  type Vote,
} from "../../app/src/goNoGo/GoNoGoHostService";
import { initSoundSettings } from "../../app/src/sound/soundSettings";
import { AppWidgetScene } from "./AppWidgetScene";

/*
 * Silenced for every story: the countdown blips each second and an abort
 * sounds a tone, neither of which a review page should play.
 */
initSoundSettings({
  get: () => false,
  subscribe: () => () => {},
});

/** The instant the view clock is pinned at, and the liftoff a launched scene is past. */
const VIEW_UT = 5_000_000;
const LIFTOFF_UT = VIEW_UT - 184;

/** The craft on the pad, or 184 s past liftoff. */
function vesselStream(launched: boolean): Record<string, unknown> {
  return {
    _stream: {
      pinnedUt: VIEW_UT,
      emits: [
        {
          channel: "vessel.identity",
          value: {
            vesselId: "ares-4",
            name: "Ares 4",
            vesselType: 0,
            situation: launched ? 5 : 2,
            parentBodyIndex: 1,
            launchUt: launched ? LIFTOFF_UT : null,
          },
        },
      ],
    },
  };
}

type Listener = (...args: never[]) => void;

/** The part of the peer host the vote aggregator listens on, driven by the scene. */
class ScenePeerHost {
  private listeners = new Map<string, Set<Listener>>();

  private on(event: string, cb: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
    return () => set.delete(cb);
  }

  fire(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }

  onPeerConnect = (cb: Listener) => this.on("connect", cb);
  onPeerDisconnect = (cb: Listener) => this.on("disconnect", cb);
  onStationInfo = (cb: Listener) => this.on("info", cb);
  onGonogoVote = (cb: Listener) => this.on("vote", cb);
  onGonogoAbort = (cb: Listener) => this.on("abort", cb);
  broadcast = () => {};
}

/** One station on the main screen's board. */
export interface SceneStation {
  peerId: string;
  name: string;
  vote: Vote;
  /** The version it reports, or none for a bundle too old to say. */
  version?: string;
}

export interface GoNoGoMainSceneProps {
  stations: readonly SceneStation[];
  /** Past liftoff, so the board reads mission active. */
  launched?: boolean;
  /** The station whose abort the host has taken, by peer id. Only honoured once launched. */
  abortBy?: string;
  /** How long a countdown the widget is configured for. */
  countdownSeconds?: number;
  w: number;
  h: number;
}

/** The version every station reports unless it says otherwise: this build's own. */
export const THIS_VERSION = "0.0.0";

/**
 * The main screen's board, over a vote aggregator fed by stations that have
 * joined and voted. Every vote lands before the widget mounts, so a board
 * whose stations are all GO is already counting down when it first draws.
 */
export function GoNoGoMainScene(props: GoNoGoMainSceneProps) {
  const { stations, launched = false, abortBy, w, h } = props;
  const countdownSeconds = props.countdownSeconds ?? 60;
  const scene = useMemo(() => {
    const peers = new ScenePeerHost();
    const service = new GoNoGoHostService(peers);
    service.setConfig({ countdownLengthMs: countdownSeconds * 1000 });
    for (const s of stations) {
      peers.fire("connect", s.peerId);
      peers.fire("info", s.peerId, {
        name: s.name,
        version: s.version,
        buildTime: s.version ? "2026-09-28T09:00:00Z" : undefined,
      });
    }
    for (const s of stations) peers.fire("vote", s.peerId, s.vote);
    return { peers, service };
  }, [stations, countdownSeconds]);
  useEffect(() => () => scene.service.dispose(), [scene]);
  /*
   * The aggregator samples the craft's identity without holding it, so on the
   * main screen something else has to. Nothing in this scene would, and the
   * probe drops an emit on a topic nobody holds.
   */
  useEffect(() => holdActiveTopicRead("vessel.identity", "gonogo story"), []);

  const wrap = useMemo(
    () => (tree: ReactNode) => (
      <ScreenProvider value="main">
        <GoNoGoHostProvider service={scene.service}>{tree}</GoNoGoHostProvider>
      </ScreenProvider>
    ),
    [scene],
  );
  const fixture = useMemo(() => vesselStream(launched), [launched]);
  const mode = useMemo(
    () => ({ config: { countdownSeconds } }),
    [countdownSeconds],
  );

  // An abort is only taken once the host has seen the craft leave the pad.
  const onDriven = async () => {
    if (abortBy === undefined) return;
    const deadline = Date.now() + 3_000;
    while (!scene.service.getSnapshot().launched && Date.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    scene.peers.fire("abort", abortBy);
  };

  return (
    <AppWidgetScene
      widgetId="gonogo"
      fixture={fixture}
      w={w}
      h={h}
      mode={mode}
      wrap={wrap}
      onDriven={onDriven}
    />
  );
}

/*
 * The station-side scene (GoNoGoStationScene) is deliberately absent: its
 * fixture needed `PeerClientService`, a 33-private-field concrete class, and
 * the only way to stand a fixture in for it was `as unknown as`, a new
 * zero-ceiling unknown-cast violation with no contained fix. It returns once
 * `usePeerClient()`/`PeerClientProvider` are typed against a narrow
 * interface instead of the concrete class.
 */
