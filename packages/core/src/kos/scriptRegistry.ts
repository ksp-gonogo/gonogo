/**
 * Registry for kerboscripts that the centralised kOS compute layer runs on
 * the user's active CPU. A widget that wants Ship Map data no longer ships
 * its own polling loop — it registers a script here at module load and
 * subscribes to the resulting `kos.compute.<id>.<field>` data keys.
 *
 * The script's `id` MUST match the `[KOSDATA:<id>]` topic the kerboscript
 * emits; the data source's parser routes blocks to subscribers by that id.
 *
 * See local_docs/centralised_kos_compute.md for the design.
 */

export interface KosScriptDefinition {
  /**
   * Topic id — must match the `[KOSDATA:<id>]` tag the script emits.
   * Used to namespace data keys and to fan out parsed blocks to subscribers.
   * Restricted to `[\w-]` so it cleanly slots into both the wire marker
   * regex and the dotted data-key path.
   */
  id: string;
  /** Human-readable name for debug surfaces (data source widget, logs). */
  name: string;
  /**
   * Kerboscript source. The data source RUNPATHs this on the active CPU on
   * every cycle. Must emit exactly one `[KOSDATA:<id>]…[/KOSDATA]` block
   * with each declared field as a key.
   */
  script: string;
  /**
   * Suggested cadence in milliseconds. v1: script-defined, not subscriber-
   * driven. The data source runs the loop at this interval whenever there
   * is at least one subscriber on any field of this topic.
   */
  intervalMs: number;
  /**
   * Fields the script promises to emit inside its `[KOSDATA]` body. Drives
   * `KosDataSource.schema()` and tells the fanout which fields to JSON.parse.
   */
  fields: KosScriptField[];
}

export interface KosScriptField {
  /** Key inside the `[KOSDATA]` body — e.g. `parts` for `parts=<json>`. */
  name: string;
  /**
   * `json` → the raw value is JSON.parse'd before being delivered to
   * subscribers. `scalar` → passed through as the parser returns it
   * (number | boolean | string per `KosDataValue`).
   */
  type: "json" | "scalar";
}

const ID_RE = /^[\w-]+$/;

const scripts = new Map<string, KosScriptDefinition>();

/**
 * Register a kerboscript with the centralised compute layer. Idempotent:
 * re-registering the same id replaces the previous definition (handy for
 * Vite HMR). Throws if the id contains characters that would break the
 * `[KOSDATA:<id>]` tag or the data-key namespace.
 */
export function registerKosScript(def: KosScriptDefinition): void {
  if (!ID_RE.test(def.id)) {
    throw new Error(
      `registerKosScript: id "${def.id}" must match /^[\\w-]+$/ — used in [KOSDATA:<id>] tags and data keys.`,
    );
  }
  if (def.fields.length === 0) {
    throw new Error(
      `registerKosScript: id "${def.id}" must declare at least one field.`,
    );
  }
  if (def.intervalMs <= 0) {
    throw new Error(
      `registerKosScript: id "${def.id}" must have intervalMs > 0 (got ${def.intervalMs}).`,
    );
  }
  scripts.set(def.id, def);
}

export function getKosScripts(): readonly KosScriptDefinition[] {
  return Array.from(scripts.values());
}

export function getKosScript(id: string): KosScriptDefinition | undefined {
  return scripts.get(id);
}

/** For use in tests only — resets the kos-script registry to empty. */
export function clearKosScripts(): void {
  scripts.clear();
}
