import type { ServerMessage } from "./envelope";
import type { TopicId } from "./topics";
import { wrapTopicPayload } from "./wrap-units";

// Guard: `satisfies Record<ServerMessage["type"], true>` forces this map to list
// EVERY ServerMessage discriminant: adding a variant to the union without adding
// its tag here is a compile error. Keeps this hand-owned seam in sync with envelope.ts.
const SERVER_TYPE_TAGS = {
  "stream-data": true,
  event: true,
  "command-response": true,
  error: true,
} satisfies Record<ServerMessage["type"], true>;

const SERVER_TYPES = new Set<string>(Object.keys(SERVER_TYPE_TAGS));

/**
 * Decode one server frame, and give its quantities their units back.
 *
 * The wrap belongs HERE rather than a layer up, because this is the seam every
 * consumer of the stream goes through: a headless script reading the socket
 * gets the same `Value`s a mounted widget does, without also having to want
 * React. It is the runtime half of what the codegen does to the types, and
 * without it every field the contract types as `Value<"m">` would arrive as a
 * bare number and render as nothing.
 *
 * Only `stream-data` is wrapped. An `event` carries no declared quantities, a
 * `command-response` is a result rather than telemetry, and a command's ARGS
 * travel the other way entirely (see `generated.test.ts` on why those stay
 * bare).
 */
export function parseServerMessage(raw: string): ServerMessage {
  const obj = JSON.parse(raw) as { type?: unknown };
  if (typeof obj.type !== "string" || !SERVER_TYPES.has(obj.type)) {
    throw new Error(`unknown envelope type: ${String(obj.type)}`);
  }
  const message = obj as ServerMessage;
  if (message.type === "stream-data") {
    // Mutates the object `JSON.parse` just produced, which nobody else holds.
    wrapTopicPayload(message.topic as TopicId, message.payload);
  }
  return message;
}
