import { type ReactNode, useEffect } from "react";
import type { PeerHostService } from "../peer/PeerHostService";
import { useUplinkLoadFailures } from "./loadFailures";
import { UplinkLoadFailureScreen } from "./UplinkLoadFailureScreen";

/**
 * Renders the dashboard only while every installed Uplink has loaded. While
 * one has failed it renders the failure screen in its place, with no way past
 * it, and tells the connected stations which Uplinks failed. Re-evaluated on
 * every roster and load outcome, so it clears on its own when the Gonogo mod's
 * stream reconnects and the Uplink loads. Used by the main screen.
 */
export function UplinkLoadGate({
  host,
  children,
}: Readonly<{
  host: Pick<PeerHostService, "setUplinkFailures">;
  children: ReactNode;
}>) {
  const failures = useUplinkLoadFailures();
  const announced = JSON.stringify(
    failures.map(({ id, name }) => ({ id, name })),
  );
  useEffect(() => {
    host.setUplinkFailures(JSON.parse(announced));
  }, [host, announced]);
  if (failures.length > 0) {
    return <UplinkLoadFailureScreen audience="main" failures={failures} />;
  }
  return <>{children}</>;
}
