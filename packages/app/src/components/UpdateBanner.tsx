import { BannerPill } from "@ksp-gonogo/ui";
import { IconButton, Tooltip } from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import styled from "styled-components";
import {
  checkLatestRelease,
  isNewer,
  type LatestRelease,
  latestReleaseSoFar,
} from "../settings/releaseCheck";
import { VERSION } from "../version";

const DISMISSED_KEY = "gonogo.update-banner.dismissed";

function readDismissed(): string | null {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeDismissed(version: string): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, version);
  } catch {
    /* storage unavailable: the banner returns on the next load */
  }
}

/**
 * Tells the operator on the main screen that a release newer than this build is
 * published, naming it and linking to its notes. The newest release comes from
 * the one check Settings also reads. Shows nothing while that check is pending
 * or when it could not be answered. Dismissing hides the banner for that
 * release only: a later release shows it again.
 */
export function UpdateBanner() {
  const [latest, setLatest] = useState<LatestRelease | null>(
    () => latestReleaseSoFar() ?? null,
  );
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  useEffect(() => {
    let live = true;
    void checkLatestRelease().then((release) => {
      if (live) setLatest(release);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!latest || latest.version === dismissed) return null;
  if (isNewer(latest.version, VERSION) !== true) return null;

  const dismiss = () => {
    writeDismissed(latest.version);
    setDismissed(latest.version);
  };

  return (
    <BannerPill
      accent="var(--color-info-mark)"
      interactive
      actions={
        <Tooltip text="Dismiss">
          <IconButton type="button" onClick={dismiss} aria-label="Dismiss">
            ×
          </IconButton>
        </Tooltip>
      }
    >
      <span>Gonogo {latest.version} is available</span>
      {latest.url && (
        <ReleaseLink href={latest.url} target="_blank" rel="noreferrer">
          Release notes
        </ReleaseLink>
      )}
    </BannerPill>
  );
}

const ReleaseLink = styled.a`
  color: inherit;
  text-decoration: underline;

  &:focus-visible {
    outline: 2px solid var(--color-info-mark);
    outline-offset: 2px;
  }
`;
