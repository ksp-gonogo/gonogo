// Hand-owned: RT cannot derive the union alias from C# generics. Under the drift gate.

import type {
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

export type ServerMessage =
  | StreamData<unknown>
  | EventMsg
  | CommandResponse<unknown>
  | ErrorMsg
  // The one member that never arrives as text. It comes off the BINARY LANE
  // (`binary-frame.ts`), already decoded, and is in the union so every
  // exhaustive switch over a server frame has to account for it rather than
  // silently dropping a delivery it does not recognise.
  | StreamBinaryMessage;

export type ClientMessage =
  | Subscribe
  | Unsubscribe
  | SetVantage
  | CommandRequest<unknown>;
