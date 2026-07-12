// SCANsat science augment for ScienceOfficer.
//
// Fills ScienceOfficer's `science-officer.badges` header slot with the
// vessel's SCANsat map-scanner experiments — parts SCANsat manages via
// `SCANexperiment`/`IScienceDataContainer`, which never appear in
// `sci.instruments` (the stock-experiment topic ScienceOfficer itself
// reads), so there is no per-instrument row to hang off. `badges` is the
// widget's broad, once-per-widget escape-hatch slot (its own doc comment:
// "badges-as-broad-escape-hatch") — the right shape for a whole extra
// section, unlike `science-officer.sections` (per-instrument, wrong shape
// here).
//
// Presence-gated on `requires: "scansat"`: `AugmentSlot` renders this only
// while `scansat.available` is live, so an install without the SCANsat mod
// never mounts it — zero impact on ScienceOfficer for non-SCANsat users.

import type {} from "@ksp-gonogo/components"; // pulls ScienceOfficer's "science-officer.badges" SlotRegistry merge into this program (see that module's own declare-module comment)
import type { SlotProps } from "@ksp-gonogo/core";
import { registerAugment, useDataValue } from "@ksp-gonogo/core";
import {
  Badge,
  ScienceExperimentRow,
  type ScienceInstrument,
} from "@ksp-gonogo/ui-kit";
import { useId, useState } from "react";
import styled from "styled-components";

/**
 * Parses `scansat.science` (`Sitrep.Contract.ScanScienceEntry[]`, built by
 * `mod/GonogoScansatUplink/ScanScience.cs`). Field names already match the
 * ui-kit row's `ScienceInstrument` shape 1:1 — the mod-side builder
 * deliberately names them to match — so this is a straight
 * nullable-wire -> plain-boolean normalisation, same pattern as
 * ScienceOfficer's own `parseInstruments`: `bool?` -> `=== true`, missing
 * `partTitle`/`expId` -> a safe fallback, entries with no `partId` skipped.
 *
 * `deployed` and `inoperable` are always `false` on the wire and
 * `rerunnable` is always `true` (SCANsat map experiments have no deploy or
 * inoperable lifecycle, and SCANsat hard-codes `IsRerunnable()` —
 * `ScanScience.cs`'s own doc comment) — so a SCANsat row's
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
 * `deployed`/`hasData` state. Wiring Deploy/Transmit is a follow-up —
 * Transmit in particular is blocked mod-side (a private SCANsat method)
 * until that lands.
 *
 * Layout tension flagged, not solved: `science-officer.badges`
 * renders inline in the header's flex `Cluster` next to the panel title, so
 * a full row list can't just sit there — it would crush the title. This
 * ships a collapsed count badge that expands a floating row list on click,
 * leaving the header's stock layout untouched either way (collapsed or
 * expanded). The clean long-term fix is a dedicated body-level
 * `science-officer.sections-append` slot on ScienceOfficer —
 * flagged for live review, not built here.
 */
function ScansatScienceAugment(_props: SlotProps<"science-officer.badges">) {
  const raw = useDataValue("data", "scansat.science");
  const experiments = parseScanScience(raw);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  if (experiments === null || experiments.length === 0) return null;

  return (
    <Wrap>
      <ToggleButton
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={`SCANsat science instruments (${experiments.length})`}
        onClick={() => setExpanded((v) => !v)}
      >
        <Badge tone="info">SCANSAT {experiments.length}</Badge>
      </ToggleButton>
      {expanded && (
        <Dropdown id={panelId} role="region" aria-label="SCANsat science">
          <RowList>
            {experiments.map((inst) => (
              <ScienceExperimentRow key={inst.partId} instrument={inst} />
            ))}
          </RowList>
        </Dropdown>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`
  position: relative;
`;

const ToggleButton = styled.button`
  display: inline-flex;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  border-radius: 3px;

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Dropdown = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  margin-top: 4px;
  min-width: 220px;
  max-width: 320px;
  padding: 8px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
`;

// `ScienceExperimentRow` renders a `<li>` (ui-kit's `Row` default) — needs a
// real `<ul>` ancestor for a11y, same as ScienceOfficer's own
// `InstrumentList`.
const RowList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

registerAugment({
  id: "scansat-science",
  augments: "science-officer.badges",
  requires: "scansat",
  channels: ["scansat.science"],
  component: ScansatScienceAugment,
});

export { ScansatScienceAugment };
