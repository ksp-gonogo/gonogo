import { radioSupportStatus } from "@ksp-gonogo/sitrep-sdk/media";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-sdk/spine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommcastLog } from "../CommcastLog";
import type { SeparationMatrix, Vantage } from "../reveal";
import type { RecipientId } from "../types";
import type { RadioReception } from "./RadioSession";
import { RadioSession } from "./RadioSession";
import type { RadioTransmitState, StartRadioCapture } from "./RadioTransmitter";
import { RadioTransmitter } from "./RadioTransmitter";
import {
  startWebAudioCapture,
  WebAudioRadioSink,
  WebCodecsRadioDecoder,
} from "./webaudio";

/**
 * The radio, mounted on one thread: a latching key at this end and whatever
 * reaches this vantage at the other.
 *
 * Both halves are built ONCE per clock and torn down with it, the same rule
 * `useCommcastFeed`'s buffer follows and for the same reason: every held
 * chunk's release instant was computed against that clock, so a rebuild has to
 * drop them rather than carry them into a clock that never promised them.
 *
 * Nothing here is built at all where the pipeline cannot run. jsdom, an
 * insecure origin and a browser without WebCodecs all land in the same branch,
 * so a test render and a station on plain http both get a stated reason and no
 * `AudioContext`.
 */

/** Everything the composer needs to draw and drive the key. */
export interface RadioControl {
  /** Keyed, and audio is going out. */
  transmitting: boolean;
  /** Keyed, and the microphone is still opening. */
  opening: boolean;
  /** What is playing here, and how far behind playback is running. */
  reception: RadioReception;
  /**
   * Why the key cannot be pressed at all, in the operator's terms, or `null`.
   *
   * An insecure origin and a missing codec are deliberately different
   * sentences: the first is something the operator can act on (reach the page
   * over https, or through localhost), the second is not. The dev server binds
   * the LAN, so a station opened at `http://<lan-ip>:5173` is in the first
   * state every single time.
   */
  unavailable: string | null;
  /** Why the last attempt to key failed, or `null`. */
  fault: string | null;
  /** Latch on, latch off. */
  toggle(): void;
}

export interface UseRadioOptions {
  log: CommcastLog | null;
  me: Vantage;
  pairs: SeparationMatrix | undefined;
  local: {
    stationKey: string;
    name: string;
    seat: Vantage["seat"];
  };
  /** The one end this thread is with, or `null` outside a thread. */
  target: RecipientId | null;
  /**
   * The separation to `target` as the widget already resolved it for its own
   * delay reading, `null` for NO PATH.
   *
   * Taken from the widget rather than resolved again here, so the badge, the
   * text composer and the radio cannot disagree about how far away the other
   * end is.
   */
  separationSeconds: number | null;
  /** Overrides the microphone, for tests and probes. */
  startCapture?: StartRadioCapture;
}

const NO_RECEPTION: RadioReception = {
  playing: null,
  backlogSeconds: 0,
  droppedChunks: 0,
};

const IDLE_TRANSMIT: RadioTransmitState = {
  live: false,
  opening: false,
  chunks: 0,
  fault: null,
};

export function useRadio({
  log,
  me,
  pairs,
  local,
  target,
  separationSeconds,
  startCapture,
}: UseRadioOptions): RadioControl {
  const clock = useViewClockOptional();
  const support = useMemo(() => radioSupportStatus(), []);
  const [session, setSession] = useState<RadioSession | null>(null);
  const [transmitter, setTransmitter] = useState<RadioTransmitter | null>(null);
  const [reception, setReception] = useState<RadioReception>(NO_RECEPTION);
  const [transmit, setTransmit] = useState<RadioTransmitState>(IDLE_TRANSMIT);

  /*
   * Read through a ref by the transmitter's own `utNow`, rather than closed
   * over, so the clock the chunks are stamped from is the live one without the
   * transmitter having to be rebuilt every frame.
   */
  const clockRef = useRef(clock);
  clockRef.current = clock;

  useEffect(() => {
    if (!log || !clock || !support.supported) {
      setSession(null);
      setReception(NO_RECEPTION);
      return;
    }
    const built = new RadioSession({
      /*
       * The reader's OWN present, never `confirmedEdgeUt()`. A human speaks at
       * their present; releasing against the confirmed edge would hold every
       * word for a round trip. Same adapter, same reasoning, as the one
       * `useCommcastFeed` hands its own buffer.
       */
      view: {
        confirmedEdgeUt: () => clock.utNowEstimate(),
        onFrame: (cb) => clock.onFrame(cb),
      },
      decoder: new WebCodecsRadioDecoder(new WebAudioRadioSink()),
    });
    setSession(built);
    setReception(built.snapshot());
    const unsubscribeState = built.subscribe(setReception);
    const unsubscribeWire = log.onRadio((frame) => built.receive(frame));
    return () => {
      unsubscribeWire();
      unsubscribeState();
      built.dispose();
      setSession(null);
      setReception(NO_RECEPTION);
    };
  }, [log, clock, support.supported]);

  useEffect(() => session?.setVantage(me), [session, me]);
  useEffect(() => session?.setPairs(pairs), [session, pairs]);

  useEffect(() => {
    if (!log || !support.supported) {
      setTransmitter(null);
      setTransmit(IDLE_TRANSMIT);
      return;
    }
    const built = new RadioTransmitter({
      send: (frame) => log.sendRadio(frame),
      utNow: () => clockRef.current?.utNowEstimate(),
      startCapture: startCapture ?? startWebAudioCapture,
    });
    setTransmitter(built);
    const unsubscribe = built.subscribe(setTransmit);
    return () => {
      unsubscribe();
      built.dispose();
      setTransmitter(null);
      setTransmit(IDLE_TRANSMIT);
    };
  }, [log, support.supported, startCapture]);

  const toggle = useCallback(() => {
    if (!transmitter) return;
    if (transmitter.snapshot().live || transmitter.snapshot().opening) {
      transmitter.keyUp();
      return;
    }
    if (target === null || me.vantageId === undefined) return;
    void transmitter.keyDown({
      to: [target],
      from: me.vantageId,
      authorStationKey: local.stationKey,
      authorName: local.name,
      authorSeat: local.seat,
      /*
       * Frozen HERE, once, and `null` is carried rather than refused: loss of
       * path stops delivery, never transmission. The operator keeps talking and
       * the bar says NO PATH; deciding from this end that nobody can hear them
       * is a claim only the other end can make.
       */
      separationSeconds,
    });
  }, [transmitter, target, me.vantageId, local, separationSeconds]);

  const unavailable = useMemo(() => {
    if (!support.supported) {
      return support.reason === "insecure-context"
        ? "Not a secure origin"
        : "No audio codec";
    }
    if (!clock) return "No clock yet";
    if (target === null) return "No recipient";
    if (me.vantageId === undefined) return "No vantage yet";
    return null;
  }, [support, clock, target, me.vantageId]);

  return {
    transmitting: transmit.live,
    opening: transmit.opening,
    reception,
    unavailable,
    fault: transmit.fault,
    toggle,
  };
}
