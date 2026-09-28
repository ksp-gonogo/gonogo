// Hand-owned: RT cannot derive the union alias from C# generics. Under the drift gate.

import type {
  CommandAccepted,
  CommandRequest,
  CommandResponse,
  ErrorMsg,
  EventMsg,
  SetVantage,
  StreamData,
  Subscribe,
  Unsubscribe,
} from "./__generated__/contract";
import type { StreamBinaryMessage } from "./binary-frame";

/**
 * Every frame the mod sends, told apart by its `type`. A binary-lane frame
 * arrives already decoded.
 *
 * @category Stream messages
 */
export type ServerMessage =
  | StreamData<unknown>
  | EventMsg
  | CommandResponse<unknown>
  | CommandAccepted
  | ErrorMsg
  // The one member that never arrives as text. It comes off the BINARY LANE
  // (`binary-frame.ts`), already decoded, and is in the union so every
  // exhaustive switch over a server frame has to account for it rather than
  // silently dropping a delivery it does not recognise.
  | StreamBinaryMessage;

/**
 * Every frame a client sends, told apart by its `type`.
 *
 * @category Stream messages
 */
export type ClientMessage =
  | Subscribe
  | Unsubscribe
  | SetVantage
  | CommandRequest<unknown>;
