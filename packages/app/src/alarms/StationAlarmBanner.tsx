import { Cluster, Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { collapseFiredContractParam } from "./firedCollapse";
import type { Alarm, AlarmSnapshot } from "./types";

/**
 * Station-side companion to AlarmBanner. Surfaces only the fired-alarm
 * acknowledge flow: warp control stays on the main screen because the
 * station can't drive it directly.
 *
 * Renders nothing while no alarms are fired; mounts as a fixed-position
 * pill at the top of the station screen when one or more fire so the
 * operator can dismiss without opening the modal.
 *
 * No alarm tone here: only the main screen chimes (via AlarmBanner's
 * useFireBeep). With every station beeping independently the operator
 * gets a multi-tab cacophony, and the room-wide ack flow already runs
 * through the host's snapshot broadcast so visual silence is in sync
 * regardless of where the ack button is pressed.
 */

export interface StationAlarmBannerProps {
  useSnapshot: () => AlarmSnapshot;
  onAcknowledge: (id: string) => void;
}

export function StationAlarmBanner({
  useSnapshot,
  onAcknowledge,
}: StationAlarmBannerProps) {
  const snap = useSnapshot();
  const fired = snap.alarms.filter((a) => a.state === "fired");
  if (fired.length === 0) return null;

  const cpCollapse = collapseFiredContractParam(fired);
  const collapsedIds = cpCollapse ? new Set(cpCollapse.ids) : null;
  const individuals = collapsedIds
    ? fired.filter((a) => !collapsedIds.has(a.id))
    : fired;

  return (
    <Wrap role="alert">
      <Stack gap="sm">
        {individuals.map((a) => (
          <Cluster justify="start" align="baseline" wrap key={a.id}>
            <Label>Fired</Label>
            <AlarmName>{a.name}</AlarmName>
            <FiredHint>{describe(a)}</FiredHint>
            <AckButton type="button" onClick={() => onAcknowledge(a.id)}>
              Acknowledge
            </AckButton>
          </Cluster>
        ))}
        {cpCollapse && (
          <Cluster justify="start" align="baseline" wrap>
            <Label>Fired</Label>
            <AlarmName>
              {cpCollapse.count} contract objectives completed
            </AlarmName>
            <AckButton
              type="button"
              onClick={() => {
                for (const id of cpCollapse.ids) onAcknowledge(id);
              }}
            >
              Acknowledge all
            </AckButton>
          </Cluster>
        )}
      </Stack>
    </Wrap>
  );
}

function describe(alarm: Alarm): string {
  if (alarm.trigger.kind === "time") return "scheduled time reached";
  if (alarm.trigger.kind === "contract-parameter") {
    return `${alarm.trigger.parameterTitle} → ${alarm.trigger.targetState}`;
  }
  if (alarm.trigger.kind === "event") {
    const { topic, eventKind } = alarm.trigger;
    return eventKind != null ? `${topic} · ${eventKind}` : topic;
  }
  const t = alarm.trigger;
  return `${t.dataKey} ${t.op} ${t.value}`;
}

const Wrap = styled.div`
  background: rgba(90, 15, 15, 0.95);
  border: 1px solid var(--color-status-nogo-bg);
  border-radius: var(--radius-pill);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  padding: var(--space-8) var(--space-16);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
  max-width: 100%;
  animation: bannerSlideIn var(--duration-entrance) var(--ease-entrance) forwards;
  transform-origin: right center;
  will-change: transform, opacity;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  @keyframes bannerSlideIn {
    from {
      opacity: 0;
      transform: translateX(40px) scaleX(0.6);
    }
    60% {
      opacity: 1;
    }
    to {
      opacity: 1;
      transform: translateX(0) scaleX(1);
    }
  }
`;

const Label = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-status-nogo-fg);
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

const FiredHint = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-xs);
  font-style: italic;
`;

const AckButton = styled.button`
  background: none;
  border: 1px solid var(--color-status-nogo-bg);
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
  padding: var(--space-2) var(--space-8);
  border-radius: var(--radius-xs);
  cursor: pointer;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  @media (hover: hover) {
    &:hover {
      background: var(--color-status-alert-muted);
    }
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;
