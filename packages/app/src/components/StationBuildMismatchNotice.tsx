import { compareVersions, parseSemver } from "@ksp-gonogo/core";
import { BannerPill } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";
import styled from "styled-components";
import type { PeerHostService } from "../peer/PeerHostService";
import { VERSION } from "../version";

/** How to move the main app to a newer build. */
export const UPGRADE_URL =
  "https://github.com/ksp-gonogo/gonogo/blob/main/docs/DEPLOYMENT.md#end-user-bundle";

type Host = Pick<PeerHostService, "onStationInfo" | "onPeerDisconnect">;

interface Skew {
  peerId: string;
  name: string;
  kind: "major" | "minor" | "unknown";
  /** The station's version, absent when it reported none. */
  version?: string;
  /** Which side is behind: the station, or this main screen. */
  older: "station" | "main";
}

const ACCENT: Record<Skew["kind"], string> = {
  major: "var(--color-nogo-mark)",
  minor: "var(--color-warn-mark)",
  unknown: "var(--color-text-muted)",
};

function behind(version: string | undefined, local: string): Skew["older"] {
  const station = parseSemver(version);
  const main = parseSemver(local);
  if (!station || !main) return "station";
  const order =
    station.major - main.major ||
    station.minor - main.minor ||
    station.patch - main.patch;
  return order < 0 ? "station" : "main";
}

/**
 * Tells the main screen when a station joins on a different build, saying which
 * side is older and, when it is the main screen, where to read how to upgrade
 * it. Raised once per station and version: a rename that re-sends the station's
 * info stays quiet, and a station that leaves takes its notice with it.
 */
export function StationBuildMismatchNotice({
  host,
  localVersion = VERSION,
}: {
  host: Host;
  /** This build's version; a test names its own. */
  localVersion?: string;
}) {
  const [skews, setSkews] = useState<readonly Skew[]>([]);

  useEffect(() => {
    const handled = new Map<string, string | undefined>();
    const offInfo = host.onStationInfo((peerId, info) => {
      if (handled.has(peerId) && handled.get(peerId) === info.version) return;
      handled.set(peerId, info.version);
      const kind = compareVersions(localVersion, info.version);
      setSkews((now) => {
        const rest = now.filter((s) => s.peerId !== peerId);
        if (kind === "same" || kind === "patch") return rest;
        return [
          ...rest,
          {
            peerId,
            name: info.name,
            kind,
            version: info.version,
            older: behind(info.version, localVersion),
          },
        ];
      });
    });
    const offLeave = host.onPeerDisconnect((peerId) => {
      handled.delete(peerId);
      setSkews((now) => now.filter((s) => s.peerId !== peerId));
    });
    return () => {
      offInfo();
      offLeave();
    };
  }, [host, localVersion]);

  return (
    <>
      {skews.map((s) => (
        <BannerPill
          key={s.peerId}
          accent={ACCENT[s.kind]}
          interactive
          role={s.kind === "major" ? "alert" : "status"}
        >
          <span>
            {s.older === "station" ? "Station" : "Main screen"} older: {s.name}{" "}
            {s.version ? `v${s.version}` : "no version"}, main v{localVersion}
          </span>
          {s.older === "main" && (
            <Link href={UPGRADE_URL} target="_blank" rel="noreferrer">
              Upgrade
            </Link>
          )}
          <Dismiss
            type="button"
            aria-label={`Dismiss the build notice for ${s.name}`}
            onClick={() =>
              setSkews((now) => now.filter((o) => o.peerId !== s.peerId))
            }
          >
            ×
          </Dismiss>
        </BannerPill>
      ))}
    </>
  );
}

const Link = styled.a`
  color: inherit;
  text-decoration: underline;

  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;

const Dismiss = styled.button`
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0 var(--gap-sub-readout);

  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;
