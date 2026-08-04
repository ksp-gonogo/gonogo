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

export type ServerMessage =
  | StreamData<unknown>
  | EventMsg
  | CommandResponse<unknown>
  | ErrorMsg;

export type ClientMessage =
  | Subscribe
  | Unsubscribe
  | SetVantage
  | CommandRequest<unknown>;
