import styled from "styled-components";

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
  const live = kind === "major" ? "assertive" : "polite";
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
    <Pill $kind={kind} role={role} aria-live={live}>
      <Dot $kind={kind} />
      <Label>{label}</Label>
      <Detail>{detail}</Detail>
    </Pill>
  );
}

const KIND_COLOR: Record<VersionMismatchKind, string> = {
  major: "#ff3b30",
  minor: "#ff9f0a",
  unknown: "#888",
};

const Pill = styled.div<{ $kind: VersionMismatchKind }>`
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.82);
  border: 1px solid ${({ $kind }) => KIND_COLOR[$kind]};
  border-radius: 999px;
  color: ${({ $kind }) => KIND_COLOR[$kind]};
  font-family: monospace;
  font-size: var(--font-size-sm, 11px);
  letter-spacing: 0.12em;
  pointer-events: none;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.5);
`;

const Dot = styled.span<{ $kind: VersionMismatchKind }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $kind }) => KIND_COLOR[$kind]};
`;

const Label = styled.span`
  font-weight: 600;
`;

const Detail = styled.span`
  color: #ccc;
  letter-spacing: 0.06em;
  text-transform: none;
`;
