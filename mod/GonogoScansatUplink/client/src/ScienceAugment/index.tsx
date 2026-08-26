// SCANsat science augment for Experiments.
//
// Fills Experiments's `experiments.actions` header slot with the
// vessel's SCANsat map-scanner experiments: parts SCANsat manages via
// `SCANexperiment`/`IScienceDataContainer`, which never appear in
// `sci.instruments` (the stock-experiment topic Experiments itself
// reads), so there is no per-instrument row to hang off. `actions` is the
// once-per-widget header slot: the right shape for a whole extra section,
// unlike `experiments.instrument` (per-instrument, wrong shape here).
//
// Deliberately NOT `science-officer.badges`: that name matches no registered
// component id, so nothing can derive it, and it collides with the framework's
// own `.badges` contribution segment.
//
// Presence-gated on `requires: "scansat"`: `AugmentSlot` renders this only
// while `scansat.available` is live, so an install without the SCANsat mod
// never mounts it: zero impact on Experiments for non-SCANsat users.

import type { Reading, SlotProps } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  ScienceExperimentRow,
  type ScienceInstrument,
  TextButton,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useId, useState } from "react";
import { SCANSAT } from "../uplink";

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * Parses `scansat.science` (`GonogoScansatUplink.ScanScienceEntry[]`, built by
 * `mod/GonogoScansatUplink/ScanScience.cs`). Field names already match the
 * ui-kit row's `ScienceInstrument` shape 1:1 (the mod-side builder
 * deliberately names them to match), so this is a straight
 * nullable-wire -> plain-boolean normalisation, same pattern as
 * Experiments's own `parseInstruments`: `bool?` -> `=== true`, missing
 * `partTitle`/`expId` -> a safe fallback, entries with no `partId` skipped.
 *
 * `deployed` and `inoperable` are always `false` on the wire and
 * `rerunnable` is always `true` (SCANsat map experiments have no deploy or
 * inoperable lifecycle, and SCANsat hard-codes `IsRerunnable()`, see
 * `ScanScience.cs`'s own doc comment), so a SCANsat row's
 * DEPLOYED/INOPERABLE/ONE-SHOT badges never show; only DATA does.
 */
export function parseScanScience(raw: unknown): ScienceInstrument[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ScienceInstrument[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const partId = typeof e.partId === "string" ? e.partId : null;
    if (partId === null) continue;
    out.push({
      partId,
      partTitle: typeof e.partTitle === "string" ? e.partTitle : "Unknown part",
      expId: typeof e.expId === "string" ? e.expId : "",
      deployed: e.deployed === true,
      hasData: e.hasData === true,
      rerunnable: e.rerunnable === true,
      inoperable: e.inoperable === true,
    });
  }
  return out;
}

/**
 * Read-only first cut: `onDeploy`/`onTransmit` are omitted, so
 * each row's action cluster renders inert buttons gated purely on
 * `deployed`/`hasData` state. Wiring Deploy/Transmit is a follow-up,
 * Transmit in particular is blocked mod-side (a private SCANsat method)
 * until that lands.
 *
 * Layout tension flagged, not solved: `experiments.actions`
 * renders inline in the header's flex `Cluster` next to the panel title, so
 * a full row list can't just sit there, it would crush the title. This
 * ships a collapsed count badge that expands a floating row list on click,
 * leaving the header's stock layout untouched either way (collapsed or
 * expanded). The clean long-term fix is to bind the universal body-level
 * `experiments.sections` segment instead: flagged for live review, not
 * built here.
 */
function ScansatScienceAugment(_props: SlotProps<"experiments.actions">) {
  // Accumulated science is a fact: it changes when a scan completes.
  const raw = stillTrue(useTelemetry("scansat.science"), undefined);
  const experiments = parseScanScience(raw);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  if (experiments === null || experiments.length === 0) return null;

  return (
    <div style={WRAP}>
      {/* TextButton is the interactive shell purely for its `:focus-visible`
          ring (a pseudo inline `style` can't express, and identical to the
          ring the styled DisclosureButton carried). The Badge is the visible
          content; inline overrides strip TextButton's link chrome so only the
          Badge shows. */}
      <TextButton
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={`SCANsat science instruments (${experiments.length})`}
        onClick={() => setExpanded((v) => !v)}
        style={DISCLOSURE_BUTTON}
      >
        <Badge severity="info">SCANSAT {experiments.length}</Badge>
      </TextButton>
      {expanded && (
        // `<section>` for its implicit role="region" (a plain
        // `<div role="region">` trips biome's useSemanticElements).
        <section id={panelId} aria-label="SCANsat science" style={DROPDOWN}>
          <ul style={ROW_LIST}>
            {experiments.map((inst) => (
              <ScienceExperimentRow key={inst.partId} instrument={inst} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
// Structural inline styles (CSS-var tokens): a one-off header dropdown, no
// reusable ui-kit primitive fits, so the layout stays local rather than
// carrying styled-components into a consumer widget. The one interactive
// concern that inline can't express (the `:focus-visible` ring) is handled by
// wrapping in ui-kit `TextButton` above.

const WRAP: CSSProperties = { position: "relative" };

// `display: inline-flex; padding: 0`: strip TextButton's inline-link chrome so
// only the Badge shows. `borderRadius` follows the focus ring around the Badge.
const DISCLOSURE_BUTTON: CSSProperties = {
  display: "inline-flex",
  padding: 0,
  borderRadius: "var(--radius-sm)",
};

const DROPDOWN: CSSProperties = {
  position: "absolute",
  top: "100%",
  right: 0,
  // Literal, and NOT --z-dropdown. This menu renders inside Experiments's
  // ui-kit Panel, which is overflow: hidden, so it is clipped at the panel
  // edge before any z-index is consulted; and that panel sits in a
  // .react-grid-item, which react-grid-layout gives a transform (its
  // useCSSTransforms default), making it a stacking context nothing inside
  // can escape. So the 20 orders nothing but its own siblings, of which there
  // are none, and promoting it would record a stacking fix that has not
  // happened. The real fix is to portal the dropdown out of the panel.
  zIndex: 20,
  marginTop: "var(--space-4)",
  minWidth: "220px",
  maxWidth: "320px",
  padding: "var(--space-8)",
  background: "var(--color-surface-raised)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-md)",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
};

// `ScienceExperimentRow` renders a `<li>` (ui-kit's `Row` default); needs a
// real `<ul>` ancestor for a11y, same as Experiments's own
// `InstrumentList`.
const ROW_LIST: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
};

registerAugment({
  id: "scansat-science",
  augments: "experiments.actions",
  requires: "scansat",
  channels: ["scansat.science"],
  component: ScansatScienceAugment,
  owner: SCANSAT,
});

export { ScansatScienceAugment };
