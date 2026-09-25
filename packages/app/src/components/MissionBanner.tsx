import { useGameContext } from "@ksp-gonogo/core";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-client";
import { MissionDate, ReadoutCaption } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { SignalDelayReadout } from "./SignalDelayReadout";
import { VantageControl } from "./VantageControl";

/**
 * Thin, unobtrusive strip across the very top of the main screen, the
 * user's own brief: "invisible banner, ie the colour of the background/
 * transparent, with small basic colour text ... maybe 30px off the top of
 * the page". Background matches the page surface, text is muted, and it
 * claims a fixed ~30px so it never has to fight the dashboard grid for
 * space. Renders left-to-right as a small `label value` field list so more
 * fields can be added later without touching the layout.
 *
 * Mounted on both screens as the first child of `<Layout as="main">` (normal
 * document flow: see either file for why no flex/position:fixed trickery is
 * needed to reserve the space). `VantageControl` renders itself differently on
 * each; nothing else here branches.
 *
 * The strip itself is deliberately NOT a live region: the time field updates
 * roughly once a second off the live view clock, and an
 * `aria-live`/`role="status"` around it would announce every tick to a screen
 * reader. A single `aria-label` on the container makes the whole strip
 * discoverable as one unit instead. A field whose value changes rarely and
 * matters when it does can still declare its own live region, and the station's
 * vantage readout is one.
 *
 * The signal delay sits beside the command centre because on a command-centre
 * screen it is that centre's distance from the craft. A pilot's is the distance
 * back to the centre mission control stands at. Either way it is only there
 * while a craft is flying.
 */
export function MissionBanner() {
  return (
    <Banner role="group" aria-label="Mission status">
      <BannerField label="UT">
        <BannerDate />
      </BannerField>
      <BannerField label="CC">
        <VantageControl />
      </BannerField>
      <SignalDelayField />
    </Banner>
  );
}

/** The view time at the one-second resolution the date shows, re-rendering only when that second changes. */
function BannerDate() {
  return <MissionDate value={useViewSecond()} />;
}

function wholeSecond(ut: number | undefined): number | undefined {
  return ut !== undefined && Number.isFinite(ut) ? Math.floor(ut) : undefined;
}

/**
 * The view clock's per-frame UT floored to a whole second before it reaches
 * state, so a frame that moves the view by a fraction of a second costs no
 * render at all.
 */
function useViewSecond(): number | undefined {
  const clock = useViewClockOptional();
  const [second, setSecond] = useState(() => wholeSecond(clock?.viewUt()));
  const lastDelivered = useRef(second);
  useEffect(() => {
    if (!clock) {
      lastDelivered.current = undefined;
      setSecond(undefined);
      return;
    }
    return clock.onFrame((ut) => {
      const next = wholeSecond(ut);
      if (next === lastDelivered.current) return;
      lastDelivered.current = next;
      setSecond(next);
    });
  }, [clock]);
  return second;
}

function BannerField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <InlinePair>
      <ReadoutCaption>{label}</ReadoutCaption>
      <FieldValue>{children}</FieldValue>
    </InlinePair>
  );
}

/** No active vessel, no field: there is no craft for a delay to be measured to. */
function SignalDelayField() {
  const { inFlight } = useGameContext();
  if (!inFlight) return null;
  return (
    <BannerField label="Delay">
      <SignalDelayReadout />
    </BannerField>
  );
}

const Banner = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-section);
  height: 30px;
  flex-shrink: 0;
  margin-bottom: var(--space-8);
  padding: 0 var(--space-2);
  background: var(--color-surface-app);
  font-variant-numeric: tabular-nums;
`;

const InlinePair = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
`;

const FieldValue = styled.span`
  font-size: var(--font-size-value);
  color: var(--color-text-muted);
`;
