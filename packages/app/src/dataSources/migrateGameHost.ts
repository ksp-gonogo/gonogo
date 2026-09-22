import { getSetting, setSetting } from "@ksp-gonogo/core";

/**
 * One-time carry-over: before `gameHost` existed, the telemetry host was saved
 * under `gonogo.datasource.sitrep` as `{host, port}`. The new port-only store
 * ignores that `host`, so lift a user's saved host into the shared `gameHost`
 * once. Idempotent; the old kerbcast host is intentionally dropped (it should
 * never have been a separate value). Delete this after a release or two.
 */
export function migrateGameHost(): void {
  if (getSetting("gameHost") !== undefined) return;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem("gonogo.datasource.sitrep");
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    const host: unknown =
      typeof parsed === "object" && parsed !== null
        ? Reflect.get(parsed, "host")
        : undefined;
    if (typeof host === "string" && host.trim() !== "") {
      setSetting("gameHost", host.trim());
    }
  } catch {
    /* malformed legacy blob: nothing to migrate */
  }
}
