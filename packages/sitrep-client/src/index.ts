export const CLIENT_VERSION = "0.0.0";

export { TelemetryClient } from "./client";
export {
  TelemetryProvider,
  type TelemetryProviderProps,
  useTelemetryClient,
} from "./context";
export type { CommandStatus } from "./lifecycle";
export { StubTransport } from "./stub-transport";
export type { Transport, TransportStatus } from "./transport";
export { type UseCommandResult, useCommand } from "./use-command";
export { useStream } from "./use-stream";
