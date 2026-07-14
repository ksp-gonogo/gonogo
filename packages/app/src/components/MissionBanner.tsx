import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { formatKspDate } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/**
 * Thin, unobtrusive strip across the very top of the main screen — the
 * user's own brief: "invisible banner, ie the colour of the background/
 * transparent, with small basic colour text ... maybe 30px off the top of
 * the page". Background matches the page surface, text is muted, and it
 * claims a fixed ~30px so it never has to fight the dashboard grid for
 * space. Renders left-to-right as a small `label value` field list so more
 * fields can be added later without touching the layout.
 *
 * Mounted on `MainScreen` only, as the first child of `<Layout as="main">`
 * (normal document flow — see that file for why no flex/position:fixed
 * trickery is needed to reserve the space). A `StationScreen` mount is a
 * trivial follow-up, not done here.
 *
 * Deliberately NOT a live region: the time field updates roughly once a
 * second off the live view clock, and an `aria-live`/`role="status"` region
 * would announce every tick to a screen reader. This is passive chrome —
 * plain muted text, with a single `aria-label` on the container so the
 * whole strip is discoverable as one unit without being read out loud on
 * every update.
 */
export function MissionBanner() {
  const ut = useViewUt();

  // Exactly one command centre exists today — this app IS the host/KSC, so
  // there's nothing to read from a data source yet. This is the seam that
  // becomes a dynamic lookup once multiple command centres exist (see
  // design memory `project_command_centres_multivantage`: gonogo's core is
  // already vantage-keyed end to end — the gap is an Uplink-side "what
  // counts as a command centre, and where" capability that hasn't been
  // built). Kept as a labelled field now so a future dynamic source drops
  // straight into this slot without touching the surrounding markup.
  const commandCentre = "KSC";

  const fields: { label: string; value: string }[] = [
    { label: "UT", value: formatKspDate(ut ?? Number.NaN) },
    { label: "CC", value: commandCentre },
  ];

  return (
    <Banner role="group" aria-label="Mission status">
      {fields.map((field) => (
        <Field key={field.label}>
          <FieldLabel>{field.label}</FieldLabel>
          <FieldValue>{field.value}</FieldValue>
        </Field>
      ))}
    </Banner>
  );
}

const Banner = styled.div`
  display: flex;
  align-items: center;
  gap: 20px;
  height: 30px;
  flex-shrink: 0;
  margin-bottom: 8px;
  padding: 0 2px;
  background: var(--color-surface-app);
  font-variant-numeric: tabular-nums;
`;

const Field = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
`;

const FieldLabel = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const FieldValue = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;
