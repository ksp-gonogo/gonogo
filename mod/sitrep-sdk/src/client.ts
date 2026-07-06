import type { ServerMessage } from "./envelope";

// Guard: `satisfies Record<ServerMessage["type"], true>` forces this map to list
// EVERY ServerMessage discriminant — adding a variant to the union without adding
// its tag here is a compile error. Keeps this hand-owned seam in sync with envelope.ts.
const SERVER_TYPE_TAGS = {
  "stream-data": true,
  event: true,
  "command-response": true,
  error: true,
} satisfies Record<ServerMessage["type"], true>;

const SERVER_TYPES = new Set<string>(Object.keys(SERVER_TYPE_TAGS));

export function parseServerMessage(raw: string): ServerMessage {
  const obj = JSON.parse(raw) as { type?: unknown };
  if (typeof obj.type !== "string" || !SERVER_TYPES.has(obj.type)) {
    throw new Error(`unknown envelope type: ${String(obj.type)}`);
  }
  return obj as ServerMessage;
}
