import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { MissionDate, ReadoutCaption } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import styled from "styled-components";
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
 */
export function MissionBanner() {
  const ut = useViewUt();

  const fields: { label: string; value: ReactNode }[] = [
    { label: "UT", value: <MissionDate value={ut} /> },
    { label: "CC", value: <VantageControl /> },
  ];

  return (
    <Banner role="group" aria-label="Mission status">
      {fields.map((field) => (
        <InlinePair key={field.label}>
          <ReadoutCaption>{field.label}</ReadoutCaption>
          <FieldValue>{field.value}</FieldValue>
        </InlinePair>
      ))}
    </Banner>
  );
}

const Banner = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-16);
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
  gap: var(--space-6);
`;

const FieldValue = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;
