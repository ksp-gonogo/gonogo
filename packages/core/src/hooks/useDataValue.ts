import { useTelemetry } from "./useTelemetry";

/**
 * @deprecated Renamed to `useTelemetry` — the canonical telemetry read hook of
 * the Uplink architecture (spec §3.3). This alias re-exports it unchanged so
 * existing call sites keep working; a later phase's codemod removes it. New
 * code should import `useTelemetry`.
 *
 * Carries the full overload set (canonical `TopicId` + both legacy
 * `DataSourceRegistry` overloads) via `typeof useTelemetry`, so behaviour and
 * typing are identical to calling `useTelemetry` directly.
 */
export const useDataValue: typeof useTelemetry = useTelemetry;
