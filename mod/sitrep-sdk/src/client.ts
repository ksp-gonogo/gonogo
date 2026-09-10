import type { ServerMessage } from "./envelope";
import type { TopicId } from "./topics";
import { wrapTopicPayload } from "./wrap-units";

// Guard: `satisfies Record<ServerMessage["type"], boolean>` forces this map to
// list EVERY ServerMessage discriminant: adding a variant to the union without
// adding its tag here is a compile error. Keeps this hand-owned seam in sync
// with envelope.ts.
//
// The VALUE is whether that variant can arrive as TEXT. Only `stream-binary` is
// false, and it is false rather than absent for the reason the map exists: a
// missing key would satisfy nothing and the guard would stop guarding, while an
// absent-and-therefore-rejected tag would look like an oversight. It is
// rejected deliberately. A JSON document claiming to be a binary frame is not
// one, because the lane's whole content is bytes that a JSON string cannot
// carry; a real one is decoded by `decodeBinaryFrame` and never comes past
// here.
const SERVER_TYPE_TAGS = {
  "stream-data": true,
  event: true,
  "command-response": true,
  error: true,
  "stream-binary": false,
} satisfies Record<ServerMessage["type"], boolean>;

const SERVER_TYPES = new Set<string>(
  Object.entries(SERVER_TYPE_TAGS)
    .filter(([, arrivesAsText]) => arrivesAsText)
    .map(([tag]) => tag),
);

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
