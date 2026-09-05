import { radioSupportStatus } from "@ksp-gonogo/sitrep-sdk/media";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-sdk/spine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommcastLog } from "../CommcastLog";
import type { SeparationMatrix, Vantage } from "../reveal";
import type { RecipientId } from "../types";
import { useRadioBackend } from "./backend";
import { loadInputDevice, saveInputDevice } from "./inputDevice";
import { loadMutedThreads, saveMutedThreads } from "./monitor";
import type { RadioReception } from "./RadioSession";
import { RadioSession } from "./RadioSession";
import type { RadioTransmitState } from "./RadioTransmitter";
import { RadioTransmitter } from "./RadioTransmitter";

/**
 * The radio, mounted on the WIDGET: a latching key at this end and everything
 * this vantage is monitoring at the other.
 *
 * On the widget rather than inside a conversation, and that is the whole
 * listening model rather than a placement. A session built per thread would
 * exist only while that thread was open, so stepping back to the inbox would
 * tear down every held chunk and going into another conversation would build a
 * fresh one, which makes what an operator can HEAR a consequence of where they
 * happened to be looking. Mission control tunes by an explicit per-loop
 * monitor, so this is mounted once, hears every conversation, and is told only
 * which ones the operator has deliberately muted.
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
  /**
   * Loudness per captured chunk, newest last, for the rail to draw this
   * screen's own voice crossing the gap.
   *
   * Local to the transmitter and never on the wire: only the operator's OWN
   * transmission is drawn, so nobody else needs the number. Empty while not
   * keyed.
   */
  amplitudes: readonly number[];
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
  /** Whether this conversation is tuned out here. */
  isMuted(threadKey: string): boolean;
  /**
   * Tune one conversation in or out, and remember it.
   *
   * A conversation rather than a view: nothing here takes an "open thread",
   * because tying audio to what is on screen would mute whoever is speaking
   * the moment the operator glanced somewhere else.
   */
  setMuted(threadKey: string, muted: boolean): void;
  /**
   * The input the operator chose to transmit from, or `null` for the browser's
   * default. Remembered per screen, the same way the mute exceptions are.
   */
  inputDeviceId: string | null;
  /** Transmit from this input from the next keying onward. */
  setInputDevice(deviceId: string | null): void;
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
}

const NO_RECEPTION: RadioReception = {
  live: [],
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
}: UseRadioOptions): RadioControl {
  const backend = useRadioBackend();
  const clock = useViewClockOptional();
  const support = useMemo(() => radioSupportStatus(), []);
  const [session, setSession] = useState<RadioSession | null>(null);
  const [transmitter, setTransmitter] = useState<RadioTransmitter | null>(null);
  const [reception, setReception] = useState<RadioReception>(NO_RECEPTION);
  const [transmit, setTransmit] = useState<RadioTransmitState>(IDLE_TRANSMIT);
  /*
   * Read once, from storage, rather than defaulted and then loaded in an
   * effect: a session built on the first render would spend a frame monitoring
   * a loop the operator had already tuned out, and one word of somebody they
   * muted last week is exactly the thing this setting exists to stop.
   */
  const [muted, setMutedThreads] = useState<ReadonlySet<string>>(() =>
    loadMutedThreads(local.stationKey),
  );
  /* Read from storage on the first render for the same reason: an operator who
     chose a headset last week must not have their first press go out through
     the laptop's own microphone while an effect catches up. */
  const [inputDeviceId, setInputDeviceId] = useState<string | null>(() =>
    loadInputDevice(local.stationKey),
  );

  /*
   * Read through a ref by the transmitter's own `utNow`, rather than closed
   * over, so the clock the chunks are stamped from is the live one without the
   * transmitter having to be rebuilt every frame.
   */
  const clockRef = useRef(clock);
  clockRef.current = clock;

  /*
   * Likewise a ref rather than a dependency: rebuilding the transmitter on a
   * device change would tear down a keying in progress, and a microphone the
   * operator swapped while talking is the one moment they are least able to
   * notice that their transmission ended. The device is read at key-down.
   */
  const inputDeviceRef = useRef(inputDeviceId);
  inputDeviceRef.current = inputDeviceId;

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
      /*
       * One output for the screen, with a lane per transmission summed into
       * it, so two people talking at once are two voices rather than one
       * garbled stream. Built here and closed by `dispose`, because every lane
       * on it belongs to chunks released against this clock.
       */
      receiver: backend.createReceiver(),
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
  }, [log, clock, support.supported, backend]);

  useEffect(() => session?.setVantage(me), [session, me]);
  useEffect(() => session?.setPairs(pairs), [session, pairs]);
  useEffect(() => session?.setMuted(muted), [session, muted]);

  const setThreadMuted = useCallback(
    (threadKey: string, next: boolean) => {
      if (muted.has(threadKey) === next) return;
      const updated = new Set(muted);
      if (next) updated.add(threadKey);
      else updated.delete(threadKey);
      // Written before the state, and outside the updater: an updater runs
      // twice under StrictMode and is no place for anything that leaves a mark.
      saveMutedThreads(local.stationKey, updated);
      setMutedThreads(updated);
    },
    [muted, local.stationKey],
  );
  const isMuted = useCallback(
    (threadKey: string) => muted.has(threadKey),
    [muted],
  );

  const setInputDevice = useCallback(
    (deviceId: string | null) => {
      // Written before the state and outside an updater, as the mute is, for
      // the same StrictMode reason.
      saveInputDevice(local.stationKey, deviceId);
      setInputDeviceId(deviceId);
    },
    [local.stationKey],
  );

  useEffect(() => {
    if (!log || !support.supported) {
      setTransmitter(null);
      setTransmit(IDLE_TRANSMIT);
      return;
    }
    const built = new RadioTransmitter({
      send: (frame) => log.sendRadio(frame),
      utNow: () => clockRef.current?.utNowEstimate(),
      startCapture: (onChunk) =>
        backend.startCapture(onChunk, {
          deviceId: inputDeviceRef.current,
        }),
    });
    setTransmitter(built);
    const unsubscribe = built.subscribe(setTransmit);
    return () => {
      unsubscribe();
      built.dispose();
      setTransmitter(null);
      setTransmit(IDLE_TRANSMIT);
    };
  }, [log, support.supported, backend]);

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
    amplitudes: transmit.amplitudes ?? [],
    reception,
    unavailable,
    fault: transmit.fault,
    toggle,
    isMuted,
    setMuted: setThreadMuted,
    inputDeviceId,
    setInputDevice,
  };
}
