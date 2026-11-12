import { useTelemetry } from "@ksp-gonogo/core";
import { type SystemUplinkHealth, useStream } from "@ksp-gonogo/sitrep-client";
import { CORE_OWNER } from "./GonogoSettings";

/** The tag a setting carries to be offered among the first-run setup's recommended settings. */
export const SETUP_SETTING_TAG = "setup";

/**
 * One place the Settings window draws settings: an owner's rows in Gonogo's
 * settings file (`gonogo`), or an Uplink's host mod settings (`mod`). The mod's
 * own rows and those of every Uplink compiled into the mod are on the Gonogo
 * tab; an installed Uplink's are on its page under the Uplinks tab.
 */
export interface SettingsHome {
  kind: "gonogo" | "mod";
  /** The owner of the rows, or the Uplink whose mod settings these are. */
  id: string;
  where: "gonogo-tab" | "uplink-page";
  /** The name the owner goes by: "Gonogo" for the mod and every Uplink compiled into it. */
  name: string;
  /** Whether one of its settings is tagged for the first-run setup. */
  setup: boolean;
}

/**
 * Every place the Settings window draws settings, the mod's own first and then
 * each Uplink in the order the mod lists them. The Settings window draws its
 * settings from this list and the first-run setup draws only from it, so the
 * setup can offer no setting that Settings does not show.
 */
export function useSettingsHomes(): SettingsHome[] {
  const health = useStream<SystemUplinkHealth>("system.uplinkHealth");
  const gonogo = useTelemetry("settings.gonogo");
  const roster =
    health.state === "observed" || health.state === "held"
      ? health.value.uplinks
      : [];
  const rows =
    gonogo.state === "observed" || gonogo.state === "held"
      ? gonogo.value.rows
      : [];

  const bundled = (id: string) =>
    roster.some((entry) => entry.id === id && entry.bundled);
  const nameOf = (id: string) =>
    id === CORE_OWNER || bundled(id)
      ? "Gonogo"
      : (roster.find((entry) => entry.id === id)?.name ?? id);
  const where = (id: string): SettingsHome["where"] =>
    id === CORE_OWNER || bundled(id) ? "gonogo-tab" : "uplink-page";

  const owners: string[] = [CORE_OWNER];
  for (const entry of roster) {
    if (!owners.includes(entry.id)) owners.push(entry.id);
  }
  for (const row of rows) {
    if (!owners.includes(row.owner)) owners.push(row.owner);
  }

  const homes: SettingsHome[] = [];
  for (const id of owners) {
    const own = rows.filter((row) => row.owner === id);
    if (own.length > 0 || id === CORE_OWNER) {
      homes.push({
        kind: "gonogo",
        id,
        where: where(id),
        name: nameOf(id),
        setup: own.some((row) => (row.tags ?? []).includes(SETUP_SETTING_TAG)),
      });
    }
    const entry = roster.find((candidate) => candidate.id === id);
    if (entry?.modSettings) {
      homes.push({
        kind: "mod",
        id,
        where: where(id),
        name: nameOf(id),
        setup: entry.available && entry.setupModSettings === true,
      });
    }
  }
  return homes;
}
