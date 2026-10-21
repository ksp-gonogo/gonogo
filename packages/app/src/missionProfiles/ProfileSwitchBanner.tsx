import { useEffect, useState } from "react";
import styled from "styled-components";
import type { ProfileDashboard } from "./ProfileDashboard";

const VISIBLE_MS = 6000;

interface ProfileSwitchBannerProps {
  dashboard: ProfileDashboard;
}

/**
 * A short notice that the dashboard switched layouts because an input was
 * pressed ("Switched to Docking (key K)"), shown the way the scene change
 * notice is: a pill that stays a few seconds, then goes. A switch made from
 * the layouts list or by a scene change shows nothing here.
 */
export function ProfileSwitchBanner({
  dashboard,
}: Readonly<ProfileSwitchBannerProps>) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(
    () =>
      dashboard.onSwitch(({ profile, cause }) => {
        if (cause.kind !== "input") return;
        setMessage(`Switched to ${profile.name} (${cause.inputLabel})`);
      }),
    [dashboard],
  );

  useEffect(() => {
    if (message === null) return;
    const id = setTimeout(() => setMessage(null), VISIBLE_MS);
    return () => clearTimeout(id);
  }, [message]);

  if (message === null) return null;

  return (
    <Banner role="status" aria-live="polite">
      {message}
    </Banner>
  );
}

const Banner = styled.div`
  display: inline-flex;
  align-items: center;
  padding: var(--inset-banner);
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid var(--color-accent-fg);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-compact);
  letter-spacing: 0.06em;
  color: var(--color-text-primary);
  pointer-events: none;
  white-space: nowrap;
`;
