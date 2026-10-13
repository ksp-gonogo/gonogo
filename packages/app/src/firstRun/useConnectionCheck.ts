import { getDataSource, useDataSources } from "@ksp-gonogo/core";
import { connectionCheck, isThisComputer, type SetupCheck } from "./checks";

/**
 * The connection to the mod as a check, read off the same `sitrep` source the
 * Settings Connection tab shows, with the address it is aimed at so a failure
 * names the host the operator can correct.
 */
export function useConnectionCheck(): SetupCheck {
  const source = useDataSources().find((s) => s.id === "sitrep");
  const { host, port } = sitrepAddress();
  return connectionCheck(source?.status, `${host}:${port}`);
}

/** Whether the connection is aimed at this computer, so KSP and the dashboard share it. */
export function useKspOnThisComputer(): boolean {
  useDataSources();
  return isThisComputer(sitrepAddress().host);
}

function sitrepAddress(): { host: string; port: number } {
  const config = getDataSource("sitrep")?.getConfig() ?? {};
  return {
    host: typeof config.host === "string" ? config.host : "localhost",
    port: typeof config.port === "number" ? config.port : 8090,
  };
}
