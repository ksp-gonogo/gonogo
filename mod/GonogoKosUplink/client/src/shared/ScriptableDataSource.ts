import type { DataSource } from "@ksp-gonogo/sitrep-sdk";
import type { KosData, KosScriptArg } from "./kos-data-parser";

/**
 * Bundled-script payload forwarded to `executeScript` so the kOS data
 * source can keep the on-volume copy of `script` in sync with the bundled
 * body — see `dataSource/kosWrapper.ts`'s `buildKosWrapper`.
 */
export interface KosManagedScript {
  /** Full bundled script body. */
  body: string;
  /** Stable hash of `body`; mismatch with the on-volume sidecar triggers a rewrite. */
  version: string;
}

/**
 * Extension of `DataSource` for sources that can dispatch a kerboscript on
 * a named CPU and resolve with its parsed `[KOSDATA]` payload. Lives in the
 * kos Uplink (not `@ksp-gonogo/core`) because the script-arg / data /
 * managed-script types it depends on are kOS-specific.
 *
 * Implemented unconditionally by `KosDataSource` and `PeerClientDataSource`
 * (the station-side mirror, which tunnels the call through PeerJS to the
 * host's kOS source) — both live in this same Uplink package. Generic
 * wrappers outside the kos Uplink (`BufferedDataSource`,
 * `PeerBroadcastingDataSource`) must NOT import this kos-typed interface —
 * a mod-agnostic package can't depend on a mod's Uplink package. They
 * define their own local, generically-typed `executeScript` structural
 * guard instead (see their own `hasExecuteScript`-shaped helpers), matching
 * every other optional-capability forward they already do.
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
