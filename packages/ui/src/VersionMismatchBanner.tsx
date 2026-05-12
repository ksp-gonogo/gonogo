import styled from "styled-components";
import { BannerPill } from "./BannerPill";

export type VersionMismatchKind = "minor" | "major" | "unknown";

export interface VersionMismatchBannerProps {
  kind: VersionMismatchKind;
  /** Local (this build's) version, e.g. "0.0.1". */
  local: string;
  /** Remote version. Pass null/undefined for the "unknown" case. */
  remote?: string | null;
  /** Optional label for the remote ("Mission Control", "kOS proxy", …). */
  remoteLabel?: string;
}

/**
 * Pinned banner shown when this screen and a peer/proxy are running
 * mismatched gonogo versions. Sits below SignalLossBanner so the two
 * never overlap when both are active. Renders nothing when `kind` is
 * "patch" or "same" — the caller decides what to do for those (typically
 * a tooltip-only annotation, not a banner).
 */
export function VersionMismatchBanner({
  kind,
  local,
  remote,
  remoteLabel = "Peer",
}: VersionMismatchBannerProps) {
  const role = kind === "major" ? "alert" : "status";
  const label =
    kind === "major"
      ? "RELOAD REQUIRED"
      : kind === "minor"
        ? "VERSION MISMATCH"
        : "VERSION UNKNOWN";
  const detail =
    kind === "unknown"
      ? `${remoteLabel} didn't report a version`
      : `${remoteLabel} v${remote ?? "?"} ↔ this v${local}`;

  return (
    <BannerPill
      accent={KIND_COLOR[kind]}
      top={56}
      zIndex={999}
      glow="0 0 12px rgba(0, 0, 0, 0.5)"
      role={role}
    >
      <Label>{label}</Label>
      <Detail>{detail}</Detail>
    </BannerPill>
  );
}

const KIND_COLOR: Record<VersionMismatchKind, string> = {
  major: "var(--color-status-nogo-bg)",
  minor: "var(--color-status-warning-bg)",
  unknown: "var(--color-text-muted)",
};

const Label = styled.span`
  font-weight: 600;
`;

const Detail = styled.span`
  color: var(--color-text-primary);
  letter-spacing: 0.06em;
  text-transform: none;
`;
