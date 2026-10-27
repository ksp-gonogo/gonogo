import { fieldsSentOnChange } from "@ksp-gonogo/sitrep-sdk";
import type { PeerMessage } from "./protocol";

/** The longest a field sent only on change goes without being sent whole to one station, so a station that rebuilt its client has it back within this long. */
const REFRESH_MS = 5_000;

const NOTHING_TO_RECORD = () => {};

/**
 * What one station was last sent of each field the mod sends only on change,
 * so a later frame can leave out a field that still holds what the station
 * has, naming it in the frame's `unchanged` list as the mod does.
 */
export class SentOnChange {
  private readonly sent = new Map<string, { value: unknown; at: number }>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /**
   * `msg` as this station is to be sent it, and a function that records what
   * it carries, to call once it has gone. Every message but a live
   * `stream-data` frame of a Topic with such fields goes as it is: a replay goes
   * whole, since it answers a station that has just subscribed and may have
   * dropped the frames before.
   */
  prepare(msg: PeerMessage): { outgoing: PeerMessage; sent: () => void } {
    if (msg.type !== "sitrep-frame" || msg.message.type !== "stream-data") {
      return { outgoing: msg, sent: NOTHING_TO_RECORD };
    }
    const frame = msg.message;
    const fields = fieldsSentOnChange(frame.topic);
    const payload: unknown = frame.payload;
    if (
      fields.length === 0 ||
      typeof payload !== "object" ||
      payload === null
    ) {
      return { outgoing: msg, sent: NOTHING_TO_RECORD };
    }

    const now = this.now();
    const leftOut: string[] = [];
    const carried: { key: string; value: unknown }[] = [];
    for (const field of fields) {
      const key = `${frame.topic}\n${field}`;
      const value: unknown = Reflect.get(payload, field);
      const last = this.sent.get(key);
      if (
        value !== undefined &&
        value !== null &&
        !msg.replay &&
        last !== undefined &&
        last.value === value &&
        now - last.at < REFRESH_MS
      ) {
        leftOut.push(field);
        continue;
      }
      carried.push({ key, value });
    }

    const sent = () => {
      for (const { key, value } of carried) {
        if (value === undefined || value === null) this.sent.delete(key);
        else this.sent.set(key, { value, at: now });
      }
    };
    if (leftOut.length === 0) return { outgoing: msg, sent };
    const kept = Object.fromEntries(
      Object.entries(payload).filter(([field]) => !leftOut.includes(field)),
    );
    return {
      outgoing: {
        ...msg,
        message: { ...frame, payload: kept, unchanged: leftOut },
      },
      sent,
    };
  }

  /** Forget everything sent, so each field goes whole in the next frame that carries it. */
  forget(): void {
    this.sent.clear();
  }
}
