import { Button } from "@ksp-gonogo/ui-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommcastLog } from "../../app/src/commcast/CommcastLog";
import type { RadioBackend } from "../../app/src/commcast/radio/backend";
import {
  CLIP_CHUNK_SECONDS,
  clipBytes,
  clipSamples,
  type RadioClip,
  readClipChunk,
} from "../../app/src/commcast/radio/clips";
import type { RadioDecoderLike } from "../../app/src/commcast/radio/RadioSession";
import type {
  HeardRadioFrame,
  RadioTransmission,
} from "../../app/src/commcast/radio/wire";
import type { ProbeMount } from "../../components/scripts/probe/probe-entry";
import {
  KEYINGS,
  type Keying,
  LINK_EDGES,
  PLAYBACK_SECONDS,
  signalQuality,
  speechChunks,
  spokenSeconds,
  staticLevel,
} from "../scripts/commsPlaybackModel";
import {
  ARES,
  CommcastScene,
  type CommcastSceneProps,
  KSC,
  ROW,
  WOOMERA,
} from "./commcastScenes";

/** The UT `commcastScenes` calls now. */
const VIEW_UT = 12_000_000;
const TICK_MS = 40;
const ONE_WAY_SECONDS = 1.3;
const SAMPLE_RATE = 48_000;
const GROUP = JSON.stringify([ARES, KSC].sort());

/**
 * What the ground station's speakers are: a Web Audio output that plays each
 * decoded chunk through a low-pass that closes as the signal fails, over a bed
 * of hiss that rises to meet it. Nothing sounds until `open` is called from a
 * press, which is what lets a browser start an audio context.
 */
class Speakers {
  private ctx: AudioContext | null = null;
  private voice: BiquadFilterNode | null = null;
  private voiceGain: GainNode | null = null;
  private hiss: GainNode | null = null;
  private nextAt = 0;

  open(): void {
    this.close();
    const ctx = new AudioContext();
    void ctx.resume();
    const voiceGain = ctx.createGain();
    const voice = ctx.createBiquadFilter();
    voice.type = "lowpass";
    voice.connect(voiceGain);
    voiceGain.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 0xffffffff - 0.5;
    }
    const voiceNode = ctx.createBufferSource();
    voiceNode.buffer = noise;
    voiceNode.loop = true;
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    voiceNode.connect(hiss);
    hiss.connect(ctx.destination);
    voiceNode.start();
    this.ctx = ctx;
    this.voice = voice;
    this.voiceGain = voiceGain;
    this.hiss = hiss;
    this.nextAt = 0;
  }

  close(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  /** Follow the signal: the voice dims and dulls, the hiss comes up. */
  follow(t: number): void {
    if (!this.ctx || !this.voice || !this.voiceGain || !this.hiss) return;
    const q = signalQuality(t);
    const now = this.ctx.currentTime;
    this.voice.frequency.setTargetAtTime(500 + 7000 * q * q, now, 0.05);
    this.voiceGain.gain.setTargetAtTime(0.05 + 0.3 * q, now, 0.05);
    this.hiss.gain.setTargetAtTime(0.18 * staticLevel(t), now, 0.08);
  }

  play(samples: Float32Array, sampleRate: number): void {
    if (!this.ctx || !this.voice) return;
    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const voiceNode = this.ctx.createBufferSource();
    voiceNode.buffer = buffer;
    voiceNode.connect(this.voice);
    this.nextAt = Math.max(this.nextAt, this.ctx.currentTime + 0.03);
    voiceNode.start(this.nextAt);
    this.nextAt += samples.length / sampleRate;
  }
}

function backendFor(speakers: Speakers): RadioBackend {
  return {
    startCapture: () => Promise.reject(new Error("playback has no microphone")),
    createReceiver: () => ({
      openStream: (): RadioDecoderLike => ({
        decode(bytes) {
          speakers.play(clipSamples(readClipChunk(bytes)), SAMPLE_RATE);
        },
        reset() {},
        close() {},
      }),
      close() {},
    }),
  };
}

function authorKey(k: Keying): string {
  return `radio-${k.from}`;
}

function chunkFrame(
  k: Keying,
  seq: number,
  bytes: Uint8Array,
  arrivedUt: number,
): HeardRadioFrame {
  const transmission: RadioTransmission = {
    id: k.id,
    groupId: GROUP,
    from: k.from === "ares" ? ARES : WOOMERA,
    authorStationKey: authorKey(k),
    authorName: k.authorName,
    authorSeat: k.from === "ares" ? "pilot" : "mission-control",
    startedUt: arrivedUt,
    separationSeconds: 0,
  };
  return {
    kind: "chunk",
    transmissionId: k.id,
    authorStationKey: authorKey(k),
    transmission,
    to: [KSC, ARES],
    seq,
    ut: arrivedUt,
    bytes,
    arrivedUt,
  };
}

/** Every chunk of one keying the ground hears, stamped to arrive one after another from its start. */
function framesOf(k: Keying, baseUt: number): HeardRadioFrame[] {
  const spoken = Math.floor(
    spokenSeconds(k, k.startAt + k.seconds) / CLIP_CHUNK_SECONDS,
  );
  const clip: RadioClip = {
    name: k.id,
    chunks: speechChunks(k.seconds, k.from === "ares" ? 190 : 330).slice(
      0,
      spoken,
    ),
    seconds: spoken * CLIP_CHUNK_SECONDS,
  };
  return clip.chunks.map((_, seq) =>
    chunkFrame(
      k,
      seq,
      clipBytes(clip, seq),
      baseUt + k.startAt + seq * CLIP_CHUNK_SECONDS,
    ),
  );
}

export interface CommsPlaybackSceneProps {
  w?: number;
  h?: number;
}

/**
 * Commcast on the ground station's thread with the craft, played through a
 * link that comes up, carries chatter, fades into a blackout that cuts a
 * transmission short, and returns. Nothing sounds until Play is pressed.
 */
export function CommsPlaybackScene({
  w = 12,
  h = 14,
}: CommsPlaybackSceneProps) {
  const speakers = useMemo(() => new Speakers(), []);
  const radio = useMemo(() => backendFor(speakers), [speakers]);
  const log = useRef<CommcastLog | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const [run, setRun] = useState(0);
  const readout = useRef<HTMLSpanElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  /* Read by `start` through a ref so the scene's props keep their identity: a new one would rebuild the log and remount the widget mid-play. */
  const playing = useRef(false);

  useEffect(
    () => () => {
      clearInterval(timer.current);
      speakers.close();
    },
    [speakers],
  );

  /* Written into the DOM: a state change would re-render here, hand the scene a new props object and rebuild its log and mount every tick. */
  const showClock = useCallback((t: number) => {
    const speaking = KEYINGS.find(
      (k) => t >= k.startAt && t < k.startAt + k.seconds,
    );
    const heard =
      speaking && (speaking.cutAt ?? Infinity) > t ? speaking : null;
    if (readout.current) {
      readout.current.textContent = `Loop clock T+${t.toFixed(1)} of T+${PLAYBACK_SECONDS}`;
    }
    if (caption.current) {
      caption.current.textContent = `Signal ${Math.round(100 * signalQuality(t))} of 100${
        heard ? `   ${heard.authorName}: "${heard.says}"` : ""
      }`;
    }
  }, []);

  const onLog = useCallback((next: CommcastLog) => {
    log.current = next;
  }, []);

  const start = useCallback(
    (mount: ProbeMount) => {
      const heard = log.current;
      if (!playing.current || !heard) return;
      const began = performance.now();
      const pending = KEYINGS.map((k) => ({ k, sent: false }));
      let edge = 0;
      clearInterval(timer.current);
      timer.current = setInterval(() => {
        const t = (performance.now() - began) / 1000;
        showClock(Math.min(t, PLAYBACK_SECONDS));
        speakers.follow(t);
        const ut = VIEW_UT + t;
        const meta = { validAt: ut, deliveredAt: ut, vantage: KSC };
        /* A sample every tick keeps the view clock running at real rate; between samples it would hold, and the radio releases chunks against it. */
        mount.emit("comms.delay", { oneWaySeconds: ONE_WAY_SECONDS }, meta);
        while (edge < LINK_EDGES.length && LINK_EDGES[edge].at <= t) {
          mount.emit(
            "comms.link",
            { connected: LINK_EDGES[edge].connected },
            meta,
          );
          edge += 1;
        }
        for (const p of pending) {
          if (p.sent || p.k.startAt > t) continue;
          p.sent = true;
          const baseUt = VIEW_UT + t - p.k.startAt;
          for (const frame of framesOf(p.k, baseUt)) heard.receiveRadio(frame);
          heard.receiveRadio({
            kind: "end",
            transmissionId: p.k.id,
            authorStationKey: authorKey(p.k),
            ut: baseUt + p.k.startAt + p.k.seconds,
          });
        }
        if (t >= PLAYBACK_SECONDS) clearInterval(timer.current);
      }, TICK_MS);
    },
    [speakers, showClock],
  );

  const play = () => {
    clearInterval(timer.current);
    speakers.open();
    playing.current = true;
    showClock(0);
    setRun((n) => n + 1);
  };

  const props = useMemo<CommcastSceneProps>(
    () => ({
      seat: "mission-control",
      vantage: KSC,
      name: "Kennedy Flight",
      oneWaySeconds: ONE_WAY_SECONDS,
      linkLost: true,
      received: [
        {
          from: ARES,
          to: [KSC],
          authorName: "Jeb",
          authorSeat: "pilot",
          body: "Ares 4 on the loop.",
          sentAt: -120,
          separationSeconds: 1.3,
        },
      ],
      presses: [{ text: "Ares 4", selector: ROW }],
      radio,
      onLog,
      onDriven: start,
      w,
      h,
    }),
    [radio, onLog, start, w, h],
  );

  return (
    <div>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <Button size="sm" onClick={play}>
          {run === 0 ? "Play" : "Replay"}
        </Button>
        <span aria-live="off" ref={readout}>
          Press Play to hear the loop
        </span>
      </div>
      <div
        ref={caption}
        aria-live="off"
        style={{ minHeight: "1.5em", margin: "0.4rem 0" }}
      />
      <CommcastScene key={run} {...props} />
    </div>
  );
}
