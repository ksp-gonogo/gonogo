// Hand-owned: RT cannot derive the union alias from C# generics. Under the drift gate.

import type {
  CommandAccepted,
  CommandGroupRequest,
  CommandRequest,
  CommandResponse,
  ErrorMsg,
  EventMsg,
  GameState,
  Hello,
  Ping,
  Pong,
  SetVantage,
  StreamData,
  Subscribe,
  Unsubscribe,
} from "./__generated__/contract";
import type { StreamBinaryMessage } from "./binary-frame";

/**
 * Every frame the mod sends, told apart by its `type`. A binary-lane frame
 * arrives already decoded. Useful for code that reads the socket itself and
 * must handle each kind of message the mod sends to the command centre. Taken
 * by the stream's WebSocket transport.
 *
 * @category Stream messages
 */
export type ServerMessage =
  | StreamData<unknown>
  | EventMsg
  | CommandResponse<unknown>
  | CommandAccepted
  | ErrorMsg
  | GameState
  | Hello
  | Pong
  // The one member that never arrives as text. It comes off the BINARY LANE
  // (`binary-frame.ts`), already decoded, and is in the union so every
  // exhaustive switch over a server frame has to account for it rather than
  // silently dropping a delivery it does not recognise.
  | StreamBinaryMessage;

/**
 * Every frame a client sends, told apart by its `type`. Useful for code that
 * writes to the socket itself, such as a subscription, a vantage change or a
 * command to a vessel. Taken by the stream's WebSocket transport.
 *
 * @category Stream messages
 */
export type ClientMessage =
  | Subscribe
  | Unsubscribe
  | SetVantage
  | CommandRequest<unknown>
  | CommandGroupRequest
  | Ping;
