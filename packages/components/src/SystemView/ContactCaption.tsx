import type { CSSProperties } from "react";
import type { SystemViewVesselStatusEntry } from "./vesselStatusContribution";

export const FRAME_CAPTION: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.05em",
  flex: "0 0 auto",
};

/**
 * Renders the contributed `system-view.vessel-status` entry; SystemView only decides which severities are announced.
 * `critical` is assertive, `warning` polite, and `info` (often a countdown) is announced by neither, since a live region would read a ticking clock aloud forever.
 */
export function ContactCaption({
  status,
  vesselName,
}: Readonly<{
  status: SystemViewVesselStatusEntry | undefined;
  vesselName: string;
}>) {
  if (!status) return null;

  if (status.severity === "critical") {
    return (
      <div style={FRAME_CAPTION} role="alert" aria-live="assertive">
        <span style={{ textDecoration: "line-through" }}>{vesselName}</span>{" "}
        {status.label.toLowerCase()}
      </div>
    );
  }

  if (status.severity === "warning") {
    return (
      <div style={FRAME_CAPTION} role="status" aria-live="polite">
        {vesselName} {status.label.toLowerCase()}
      </div>
    );
  }

  return (
    <div style={FRAME_CAPTION}>
      {vesselName} {status.label.toLowerCase()}
    </div>
  );
}
