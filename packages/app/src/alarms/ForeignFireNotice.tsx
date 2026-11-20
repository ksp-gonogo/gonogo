import { BannerRow } from "@ksp-gonogo/ui";
import { Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { useVantageName } from "./foreignAlarm";
import type { AlarmSnapshot } from "./types";

/**
 * Announces alarms that fired on another screen's behalf.
 *
 * Every screen hears every alarm fire, but a screen at a different vantage is
 * told only that one armed at that vantage fired, never what it watched.
 */
export function ForeignFireNotice({
  snap,
  onAcknowledge,
}: {
  snap: AlarmSnapshot;
  onAcknowledge: (id: string) => void;
}) {
  const nameOf = useVantageName();
  const fires = snap.scetForeignFired ?? [];
  if (fires.length === 0) return null;

  return (
    <Wrap role="alert">
      <Stack gap="related-dense">
        {fires.map((fire) => {
          const row = snap.scetForeign?.find((a) => a.id === fire.id);
          const withheld = row ? row.withheld : true;
          const title = withheld
            ? row
              ? `Alarm armed at ${nameOf(row.armedBy)}`
              : "An alarm armed elsewhere"
            : row?.name || fire.id;
          return (
            <BannerRow
              key={fire.id}
              actions={
                <AckButton type="button" onClick={() => onAcknowledge(fire.id)}>
                  Acknowledge
                </AckButton>
              }
            >
              <Label>Fired</Label>
              <AlarmName>{title}</AlarmName>
            </BannerRow>
          );
        })}
      </Stack>
    </Wrap>
  );
}

const Wrap = styled.div`
  background: color-mix(in srgb, var(--color-alarm-notice) 95%, transparent);
  border: var(--border-width-hairline) solid var(--color-nogo-mark);
  border-radius: var(--radius-banner);
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
  padding: var(--inset-banner);
  box-shadow: var(--shadow-banner);
  pointer-events: auto;
  max-width: 100%;
`;

const Label = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: calc(0.14em * var(--tracking-scale));
  text-transform: uppercase;
  color: var(--color-nogo-text);
  font-weight: var(--font-weight-bold);
`;

const AlarmName = styled.span`
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
  max-width: 22em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AckButton = styled.button`
  background: none;
  border: var(--border-width-hairline) solid var(--color-nogo-mark);
  color: var(--color-nogo-text);
  font-size: var(--font-size-compact);
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  cursor: pointer;
  letter-spacing: calc(0.06em * var(--tracking-scale));
  text-transform: uppercase;
  @media (hover: hover) {
    &:hover {
      background: var(--color-nogo-muted);
    }
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;
