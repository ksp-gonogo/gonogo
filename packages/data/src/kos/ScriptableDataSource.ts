import type { DataSource } from "@ksp-gonogo/core";
import type { KosManagedScript } from "../hooks/useKosWidget";
import type { KosData, KosScriptArg } from "./kos-data-parser";

/**
 * Extension of `DataSource` for sources that can dispatch a kerboscript on
 * a named CPU and resolve with its parsed `[KOSDATA]` payload. Lives in
 * `@ksp-gonogo/data` rather than `@ksp-gonogo/core` because the script-arg / data /
 * managed-script types it depends on are kOS-specific and already defined
 * in this package — pulling them up into core would invert the dependency.
 *
 * Implemented unconditionally by `KosDataSource` and `PeerClientDataSource`
 * (the station-side mirror, which tunnels the call through PeerJS to the
 * host's kOS source). Wrappers like `BufferedDataSource` and
 * `PeerBroadcastingDataSource` may or may not expose `executeScript`
 * depending on whether their wrapped source implements it — call sites
 * narrow with `isScriptable(source)`.
 */
export interface ScriptableDataSource<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> extends DataSource<TConfig> {
  executeScript(
    cpu: string,
    script: string,
    args: KosScriptArg[],
    managed?: KosManagedScript,
  ): Promise<KosData>;
}

export function isScriptable(
  source: DataSource | undefined | null,
): source is ScriptableDataSource {
  return (
    !!source &&
    typeof (source as Partial<ScriptableDataSource>).executeScript ===
      "function"
  );
}
