import { useTelemetry } from "@ksp-gonogo/core";
import {
  SettingKind,
  type SettingsModel,
  type SettingsRowState,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect } from "react";
import type { SettingsService } from "./SettingsService";

/**
 * The block the mod keeps the screens' own settings in. A row there is named
 * by the id a screen reads it under, so `CONSOLE/sound.enabled` is
 * `sound.enabled` here.
 */
const CONSOLE_BLOCK = "CONSOLE/";

/** The owner the mod writes for its own rows, as against an Uplink's id. */
const CORE_OWNER = "gonogo";

/**
 * Copy every console row of `model` into `service`, whatever `service` held.
 *
 * The settings file is the one answer for every screen of a game, so what a
 * screen stored locally is only a copy of it: it stands in until the host
 * reports, and the host's value replaces it. Nothing flows the other way, so
 * a screen's copy can never overwrite the file.
 */
export function applyConsoleSettings(
  model: SettingsModel,
  service: SettingsService,
): void {
  for (const row of model.rows) {
    if (row.owner !== CORE_OWNER || !row.path.startsWith(CONSOLE_BLOCK)) {
      continue;
    }
    const parsed = parsedValue(row);
    if (parsed !== undefined) {
      service.set(row.path.slice(CONSOLE_BLOCK.length), parsed);
    }
  }
}

function parsedValue(
  row: SettingsRowState,
): boolean | number | string | undefined {
  switch (row.kind) {
    case SettingKind.Bool:
      return row.value === "True"
        ? true
        : row.value === "False"
          ? false
          : undefined;
    case SettingKind.Number: {
      const n = Number(row.value);
      return row.value.trim() !== "" && Number.isFinite(n) ? n : undefined;
    }
    case SettingKind.Text:
      return row.value;
    default:
      return undefined;
  }
}

/**
 * Keep `service`'s console settings equal to the host's for as long as it is
 * mounted. Mount once per screen, inside the telemetry provider: the station
 * reads the same topic relayed from the main screen.
 */
export function ConsoleSettingsFromHost({
  service,
}: {
  service: SettingsService;
}) {
  const reading = useTelemetry("settings.gonogo");
  const model =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value
      : undefined;
  useEffect(() => {
    if (model) applyConsoleSettings(model, service);
  }, [model, service]);
  return null;
}
