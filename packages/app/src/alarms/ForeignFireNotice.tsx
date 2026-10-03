import { Cluster, Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { useVantageName } from "./foreignAlarm";
import type { AlarmSnapshot } from "./types";

/**
 * Announces alarms that fired on another screen's behalf.
 *
 * Every screen hears every alarm fire, but a screen at a different vantage is
 * told only THAT one armed at that vantage fired, never what it watched.
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
            <Cluster justify="start" align="baseline" wrap key={fire.id}>
              <Label>Fired</Label>
              <AlarmName>{title}</AlarmName>
              <AckButton type="button" onClick={() => onAcknowledge(fire.id)}>
                Acknowledge
              </AckButton>
            </Cluster>
          );
        })}
      </Stack>
    </Wrap>
  );
}

const Wrap = styled.div`
  background: rgba(90, 15, 15, 0.95);
  border: 1px solid var(--color-nogo-mark);
  border-radius: var(--radius-pill);
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
  padding: var(--inset-banner);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
  max-width: 100%;
`;

const Label = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-nogo-text);
  font-weight: 700;
`;

const AlarmName = styled.span`
  color: var(--color-text-primary);
  font-weight: 600;
  max-width: 22em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AckButton = styled.button`
  background: none;
  border: 1px solid var(--color-nogo-mark);
  color: var(--color-nogo-text);
  font-size: var(--font-size-compact);
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  cursor: pointer;
  letter-spacing: 0.06em;
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
