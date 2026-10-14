import { getDataSource, useDataSources } from "@ksp-gonogo/core";
import { useEffect, useState } from "react";
import {
  CONNECT_GRACE_MS,
  connectionCheck,
  isThisComputer,
  type SetupCheck,
} from "./checks";

/*
 * When the connection was first seen unanswered, kept across steps so the
 * connect and health steps agree on how long it has been. Cleared the moment a
 * mounted step sees it connect.
 */
let unansweredSince: number | null = null;

/** Test-only: forget how long the connection has been unanswered. */
export function __resetConnectionClock(): void {
  unansweredSince = null;
}

function useGaveUp(connected: boolean): boolean {
  const [, tick] = useState(0);
  useEffect(() => {
    if (connected) {
      unansweredSince = null;
      return;
    }
    unansweredSince ??= Date.now();
    const left = unansweredSince + CONNECT_GRACE_MS - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [connected]);
  return (
    !connected &&
    unansweredSince !== null &&
    Date.now() - unansweredSince >= CONNECT_GRACE_MS
  );
}

/**
 * The connection to the mod as a check, read off the same `sitrep` source the
 * Settings Connection tab shows, with the address it is aimed at so a failure
 * names the host the operator can correct.
 */
export function useConnectionCheck(): SetupCheck {
  const source = useDataSources().find((s) => s.id === "sitrep");
  const { host, port } = sitrepAddress();
  const gaveUp = useGaveUp(source?.status === "connected");
  return connectionCheck(source?.status, `${host}:${port}`, gaveUp);
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
