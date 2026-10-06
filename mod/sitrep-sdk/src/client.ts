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
  "command-accepted": true,
  error: true,
  "game-state": true,
  "stream-binary": false,
} satisfies Record<ServerMessage["type"], boolean>;

const SERVER_TYPES = new Set<string>(
  Object.entries(SERVER_TYPE_TAGS)
    .filter(([, arrivesAsText]) => arrivesAsText)
    .map(([tag]) => tag),
);

/**
 * Returns one frame from the mod, parsed from its JSON text, with every
 * quantity in a `stream-data` payload turned into a `Value` in its declared
 * unit. Other message types are returned as parsed.
 *
 * @category Stream messages
 */
export function parseServerMessage(raw: string): ServerMessage {
  const obj: unknown = JSON.parse(raw);
  if (typeof obj !== "object" || obj === null) {
    throw new Error(`envelope is not an object: ${raw.slice(0, 64)}`);
  }
  const type: unknown = Reflect.get(obj, "type");
  if (typeof type !== "string" || !SERVER_TYPES.has(type)) {
    throw new Error(`unknown envelope type: ${String(type)}`);
  }
  const message = obj as ServerMessage;
  if (message.type === "stream-data") {
    // Mutates the object `JSON.parse` just produced, which nobody else holds.
    wrapTopicPayload(message.topic as TopicId, message.payload);
  }
  return message;
}
