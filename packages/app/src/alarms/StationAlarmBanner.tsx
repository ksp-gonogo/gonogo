import { BannerRow } from "@ksp-gonogo/ui";
import { Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { FirstSignalNotice } from "./AlarmBanner";
import { orderAlarms } from "./alarmOrder";
import { ScreenFiredFacts } from "./FiredFacts";
import { ForeignFireNotice } from "./ForeignFireNotice";
import { collapseFiredContractParam } from "./firedCollapse";
import type { Alarm, AlarmSnapshot } from "./types";

/**
 * Station-side companion to AlarmBanner. Surfaces the fired-alarm
 * acknowledge flow and the strip after a switch of craft, which says which
 * craft was switched to and why nothing of it shows yet: warp control stays on
 * the main screen because the station can't drive it directly.
 *
 * Renders nothing while no alarms are fired and no switch awaits its first
 * signal; mounts as a fixed-position pill at the top of the station screen when
 * one or more fire so the operator can dismiss without opening the modal.
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
  const fired = orderAlarms(
    snap.alarms.filter((a) => a.state === "fired" || a.state === "firing"),
  );
  const foreign = (
    <>
      {snap.firstSignal && <FirstSignalNotice waiting={snap.firstSignal} />}
      <ForeignFireNotice snap={snap} onAcknowledge={onAcknowledge} />
    </>
  );
  if (fired.length === 0) return foreign;

  const cpCollapse = collapseFiredContractParam(fired);
  const collapsedIds = cpCollapse ? new Set(cpCollapse.ids) : null;
  const individuals = collapsedIds
    ? fired.filter((a) => !collapsedIds.has(a.id))
    : fired;

  return (
    <>
      {foreign}
      <Wrap role="alert">
        <Stack gap="related-dense">
          {individuals.length > 0 && (
            <BannerRow
              actions={
                <AckButton
                  type="button"
                  onClick={() => {
                    for (const a of individuals) onAcknowledge(a.id);
                  }}
                >
                  {individuals.length > 1 ? "Acknowledge all" : "Acknowledge"}
                </AckButton>
              }
            >
              <Label>
                {individuals[0].state === "firing" ? "Firing" : "Fired"}
              </Label>
              <AlarmName>{individuals[0].name}</AlarmName>
              <FiredHint>{describe(individuals[0])}</FiredHint>
              <ScreenFiredFacts
                alarm={individuals[0]}
                warpRate={snap.warp.rate}
                viewUt={snap.ut}
              />
              {individuals.length > 1 && (
                <FiredHint>
                  also fired:{" "}
                  {individuals
                    .slice(1)
                    .map((a) => a.name)
                    .join(", ")}
                </FiredHint>
              )}
            </BannerRow>
          )}
          {cpCollapse && (
            <BannerRow
              actions={
                <AckButton
                  type="button"
                  onClick={() => {
                    for (const id of cpCollapse.ids) onAcknowledge(id);
                  }}
                >
                  Acknowledge all
                </AckButton>
              }
            >
              <Label>Fired</Label>
              <AlarmName>
                {cpCollapse.count} contract objectives completed
              </AlarmName>
            </BannerRow>
          )}
        </Stack>
      </Wrap>
    </>
  );
}

function describe(alarm: Alarm): string {
  if (alarm.trigger.kind === "time") return "scheduled time reached";
  if (alarm.trigger.kind === "contract-parameter") {
    return `${alarm.trigger.parameterTitle} → ${alarm.trigger.targetState}`;
  }
  if (alarm.trigger.kind === "instant") {
    return `${alarm.trigger.topic}.${alarm.trigger.fieldPath} reached`;
  }
  const t = alarm.trigger;
  return `${t.dataKey} ${t.op} ${t.value}`;
}

const Wrap = styled.div`
  background: color-mix(in srgb, var(--color-alarm-notice) 95%, transparent);
  border: var(--border-width-hairline) solid var(--color-nogo-mark);
  /* Half the strip's single-row height, so one row is still a pill and a wrapped line keeps square-ish corners clear of its text. */
  border-radius: min(var(--radius-banner), 1.5rem);
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
  padding: var(--inset-banner);
  box-shadow: var(--shadow-banner);
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

const FiredHint = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
  font-style: italic;
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
