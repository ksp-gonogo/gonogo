import { getDataSource, useDataSources } from "@ksp-gonogo/core";
import { connectionCheck, type SetupCheck } from "./checks";

/**
 * The connection to the mod as a check, read off the same `sitrep` source the
 * Settings Connection tab shows, with the address it is aimed at so a failure
 * names the host the operator can correct.
 */
export function useConnectionCheck(): SetupCheck {
  const source = useDataSources().find((s) => s.id === "sitrep");
  const config = getDataSource("sitrep")?.getConfig() ?? {};
  const host = typeof config.host === "string" ? config.host : "localhost";
  const port = typeof config.port === "number" ? config.port : 8090;
  return connectionCheck(source?.status, `${host}:${port}`);
}
