import { PerfBudget } from "@ksp-gonogo/core";
import { logger } from "@ksp-gonogo/logger";
import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import type {
  CommcastLog,
  CommcastTransmitter,
  OutgoingAck,
} from "./CommcastLog";
import { opensGroup } from "./groups";
import type {
  HeardRadioFrame,
  RadioFrame,
  RadioTransmission,
} from "./radio/wire";
import { COMMCAST_RADIO_TOPIC, COMMCAST_TRAFFIC_TOPIC } from "./topics";
import type { CommsMessage } from "./types";

/**
 * Chunks per batch sent up to the mod: 200 ms of the 20 ms grid. Each batch
 * comes back down as one binary frame per listener, and the per-frame header
 * is what costs, not the audio.
 */
const CHUNKS_PER_BATCH = 10;

/** Seconds of audio one chunk carries: the 20 ms Opus grid. */
const CHUNK_SECONDS = 0.02;

/** Wall ms a part-filled batch waits before it goes up anyway. */
const BATCH_FLUSH_MS = 250;

/**
 * Commcast commands this screen sends to the mod, per second. Radio batches at
 * five a second per talker plus text at typing rates; a sustained rate past
 * this is something retransmitting in a loop.
 */
const COMMCAST_COMMAND_BUDGET = new PerfBudget({
  name: "Commcast commands/sec",
  threshold: 30,
  windowMs: 1000,
  unit: "commands",
});

/** The slice of a Sitrep client the link drives. `TelemetryClient` has all three. */
export interface CommcastWire {
  dispatch(command: string, args?: unknown): { result: Promise<unknown> };
  subscribe(topic: string, cb: (payload: unknown) => void): () => void;
  onRawMessage(listener: (message: ServerMessage) => void): () => void;
}

interface PendingBatch {
  frames: Extract<RadioFrame, { kind: "chunk" }>[];
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** One keying this screen is speaking: what every batch of it names, and where the next begins. */
interface Keying {
  transmission: RadioTransmission;
  authorStationKey: string;
  nextSeq: number;
}

/**
 * Put `log` on the mod: what it says goes up as commands, and what is said to
 * this vantage comes down on `commcast.traffic` and `commcast.radio`, already
 * delayed by the mod for the light-time from each speaker. Returns the way off.
 *
 * The same on every screen. A host reaches the mod on its own socket; a station
 * or a remote pilot reaches it through the host, whose relays carry both topics
 * to the screens at the vantage they were addressed to.
 */
export function attachCommcastModLink(
  log: CommcastLog,
  wire: CommcastWire,
): () => void {
  const batches = new Map<string, PendingBatch>();
  const keyings = new Map<string, Keying>();

  const send = (command: string, args: unknown) => {
    COMMCAST_COMMAND_BUDGET.record();
    wire
      .dispatch(command, args)
      .result.then((result) => {
        const reason = refusalOf(result);
        if (reason === null) return;
        logger.warn("[commcast] the mod refused a command", {
          command,
          reason,
        });
      })
      .catch((err) => {
        logger.warn("[commcast] a command did not complete", {
          command,
          err: String(err),
        });
      });
  };

  const flush = (transmissionId: string, end: boolean) => {
    const batch = batches.get(transmissionId);
    const keying = keyings.get(transmissionId);
    if (batch?.timer !== undefined) clearTimeout(batch.timer);
    batches.delete(transmissionId);
    if (end) keyings.delete(transmissionId);
    const frames = batch?.frames ?? [];
    // A key-up with nothing spoken since the last batch still ends the keying, so it goes up empty.
    if (!keying || (frames.length === 0 && !end)) return;
    const { transmission } = keying;
    send("commcast.radio.transmit", {
      transmissionId,
      groupId: transmission.groupId,
      seq: frames[0]?.seq ?? keying.nextSeq,
      chunks: frames.map((f) => toBase64(f.bytes)),
      end,
      author: authorOf(
        transmission.authorName,
        keying.authorStationKey,
        transmission.authorSeat,
      ),
    });
  };

  const transmitter: CommcastTransmitter = {
    transmit(msg: CommsMessage) {
      const author = authorOf(
        msg.authorName,
        msg.authorStationKey,
        msg.authorSeat,
      );
      if (msg.kind === "members") {
        if (opensGroup(msg)) {
          send("commcast.group.open", {
            groupId: msg.groupId,
            members: msg.members ?? [],
            author,
          });
          return;
        }
        send("commcast.group.add", {
          groupId: msg.groupId,
          added: msg.added ?? [],
          author,
        });
        return;
      }
      send("commcast.message.send", {
        id: msg.id,
        groupId: msg.groupId,
        body: msg.body ?? "",
        author,
      });
    },
    acknowledge(ack: OutgoingAck) {
      send("commcast.message.ack", {
        messageId: ack.messageId,
        author: authorOf("", ack.stationKey, ack.seat),
      });
    },
    radio(frame: RadioFrame) {
      if (frame.kind === "end") {
        flush(frame.transmissionId, true);
        return;
      }
      keyings.set(frame.transmissionId, {
        transmission: frame.transmission,
        authorStationKey: frame.authorStationKey,
        nextSeq: frame.seq + 1,
      });
      let batch = batches.get(frame.transmissionId);
      if (!batch) {
        batch = { frames: [], timer: undefined };
        batches.set(frame.transmissionId, batch);
      }
      batch.frames.push(frame);
      if (batch.frames.length >= CHUNKS_PER_BATCH) {
        flush(frame.transmissionId, false);
        return;
      }
      if (batch.timer === undefined) {
        batch.timer = setTimeout(
          () => flush(frame.transmissionId, false),
          BATCH_FLUSH_MS,
        );
      }
    },
  };

  const offTraffic = wire.subscribe(COMMCAST_TRAFFIC_TOPIC, () => {});
  const offRadio = wire.subscribe(COMMCAST_RADIO_TOPIC, () => {});
  const offRaw = wire.onRawMessage((message) => {
    if (
      message.type === "stream-data" &&
      message.topic === COMMCAST_TRAFFIC_TOPIC
    ) {
      const item = readTraffic(message.payload);
      if (!item) {
        logger.warn("[commcast] a traffic item could not be read");
        return;
      }
      receiveTraffic(log, item, message.meta.validAt, message.meta.deliveredAt);
      return;
    }
    if (
      message.type === "stream-binary" &&
      message.topic === COMMCAST_RADIO_TOPIC
    ) {
      for (const frame of heardFrames(
        message.segments,
        message.meta.deliveredAt,
      )) {
        if (frame.authorStationKey === log.screenKey) continue;
        log.receiveRadio(frame);
      }
    }
  });

  log.setTransmitter(transmitter);
  return () => {
    log.setTransmitter(undefined);
    for (const batch of batches.values()) {
      if (batch.timer !== undefined) clearTimeout(batch.timer);
    }
    batches.clear();
    keyings.clear();
    offRaw();
    offRadio();
    offTraffic();
  };
}

/** How a speaker described itself, as it arrives in a traffic item or a radio batch. */
interface AuthorWire {
  name: string;
  stationKey: string;
  seat: string;
}

/** A `commcast.traffic` item, narrowed off the wire. */
interface TrafficWire {
  kind: string;
  id: string | undefined;
  groupId: string;
  from: string;
  author: AuthorWire;
  to: string[];
  body: string | undefined;
  members: string[] | undefined;
  added: string[] | undefined;
  messageId: string | undefined;
}

/** The JSON segment that opens a `commcast.radio` frame, narrowed off the wire. */
interface BatchWire {
  transmissionId: string;
  groupId: string;
  from: string;
  author: AuthorWire;
  startedUt: number;
  seq: number;
  end: boolean;
  to: string[];
}

/**
 * One `commcast.traffic` item, handed to the log unless this screen said it.
 * `sentUt` is the delivery's own `validAt`, which the item's field restates.
 */
function receiveTraffic(
  log: CommcastLog,
  item: TrafficWire,
  sentUt: number,
  arrivedUt: number,
): void {
  if (item.author.stationKey === log.screenKey) return;
  const seat = seatOf(item.author.seat);
  if (item.kind === "ack") {
    if (!item.messageId) return;
    log.receiveAck({
      messageId: item.messageId,
      from: item.from,
      stationKey: item.author.stationKey,
      seat,
      atUt: sentUt,
      arrivedUt,
    });
    return;
  }
  if (!item.id) return;
  log.receiveTransmission({
    id: item.id,
    groupId: item.groupId,
    to: item.to,
    from: item.from,
    authorStationKey: item.author.stationKey,
    authorName: item.author.name,
    authorSeat: seat,
    sentUt,
    lastSentUt: sentUt,
    attempts: 1,
    separationSeconds: arrivedUt - sentUt,
    kind: item.kind === "members" ? "members" : "text",
    arrivedUt,
    ...(item.body === undefined ? {} : { body: item.body }),
    ...(item.members === undefined ? {} : { members: item.members }),
    ...(item.added === undefined ? {} : { added: item.added }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" ? v : undefined;
}

function texts(o: Record<string, unknown>, key: string): string[] | undefined {
  const v = o[key];
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const entry of v) {
    if (typeof entry !== "string") return undefined;
    out.push(entry);
  }
  return out;
}

function readAuthor(value: unknown): AuthorWire | null {
  if (!isRecord(value)) return null;
  return {
    name: text(value, "name") ?? "",
    stationKey: text(value, "stationKey") ?? "",
    seat: text(value, "seat") ?? "",
  };
}

function readTraffic(value: unknown): TrafficWire | null {
  if (!isRecord(value)) return null;
  const kind = text(value, "kind");
  const groupId = text(value, "groupId");
  const from = text(value, "from");
  const author = readAuthor(value.author);
  const to = texts(value, "to");
  if (kind === undefined || groupId === undefined || from === undefined) {
    return null;
  }
  if (!author || !to) return null;
  return {
    kind,
    id: text(value, "id"),
    groupId,
    from,
    author,
    to,
    body: text(value, "body"),
    members: texts(value, "members"),
    added: texts(value, "added"),
    messageId: text(value, "messageId"),
  };
}

function readBatch(value: unknown): BatchWire | null {
  if (!isRecord(value)) return null;
  const transmissionId = text(value, "transmissionId");
  const groupId = text(value, "groupId");
  const from = text(value, "from");
  const author = readAuthor(value.author);
  const to = texts(value, "to");
  const { startedUt, seq, end } = value;
  if (transmissionId === undefined || groupId === undefined) return null;
  if (from === undefined || !author || !to) return null;
  if (typeof startedUt !== "number" || typeof seq !== "number") return null;
  return {
    transmissionId,
    groupId,
    from,
    author,
    startedUt,
    seq,
    end: end === true,
    to,
  };
}

/**
 * The frames one `commcast.radio` delivery carries: segment 0 describes the
 * batch, the rest are its 20 ms chunks in order. The batch was spoken over the
 * stretch before the mod stamped it, so each chunk arrived that much earlier
 * than the last, and they play back on their own grid.
 */
export function heardFrames(
  segments: readonly Uint8Array[],
  deliveredAt: number,
): HeardRadioFrame[] {
  const [head, ...chunks] = segments;
  if (!head) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(head));
  } catch {
    parsed = null;
  }
  const batch = readBatch(parsed);
  if (!batch) {
    logger.warn("[commcast] a radio frame's description could not be read");
    return [];
  }
  const { startedUt } = batch;
  const transmission = {
    id: batch.transmissionId,
    groupId: batch.groupId,
    from: batch.from,
    authorStationKey: batch.author.stationKey,
    authorName: batch.author.name,
    authorSeat: seatOf(batch.author.seat),
    startedUt,
    separationSeconds: null,
  };
  const frames: HeardRadioFrame[] = chunks.map((bytes, i) => ({
    kind: "chunk",
    transmissionId: batch.transmissionId,
    authorStationKey: batch.author.stationKey,
    transmission,
    to: batch.to,
    seq: batch.seq + i,
    ut: startedUt,
    bytes,
    arrivedUt: deliveredAt - (chunks.length - 1 - i) * CHUNK_SECONDS,
  }));
  if (batch.end) {
    frames.push({
      kind: "end",
      transmissionId: batch.transmissionId,
      authorStationKey: batch.author.stationKey,
      ut: deliveredAt,
    });
  }
  return frames;
}

function authorOf(name: string, stationKey: string, seat: Seat) {
  return { name, stationKey, seat };
}

function seatOf(seat: string): Seat {
  return seat === "pilot" ? "pilot" : "mission-control";
}

/** Why the mod refused a command, or `null` when it did not. */
function refusalOf(result: unknown): string | null {
  if (!isRecord(result) || result.success !== false) return null;
  return text(result, "reason") ?? "no reason given";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
