import { registerAugment } from "@ksp-gonogo/core";
import { Badge, type BadgeTone } from "@ksp-gonogo/ui";
// biome-ignore lint/style/noRestrictedImports: this augment renders inside LifeSupportSystems' own Panel, which is itself still styled-components throughout (not yet migrated to ui-kit), matching the host's existing pattern rather than mixing two styling systems in one widget.
import styled from "styled-components";

/**
 * Greenhouse section, the built-in filler for the `life-support.sections`
 * augment slot (see `index.tsx`'s slot doc comment). Registered as an
 * ordinary augment rather than baked into the host body so a future
 * non-Kerbalism life-support source can leave the slot empty with no code
 * change on either side, matching every other `*.sections` slot's contract.
 *
 * Renders ONLY the fields Kerbalism's own `Greenhouse.Data` class actually
 * carries (`natural`, `artificial`, `issue`) plus the part's persisted
 * `active` toggle and its derived continuous food-production rate. There is
 * deliberately NO growth meter and NO time-to-harvest countdown anywhere in
 * this file, neither concept exists in the module (production is
 * continuous via a ResourceRecipe, not a discrete harvest event); see the
 * `greenhouse-growing`/`greenhouse-blocked` fixtures' own `_meta` for the
 * full grounding against `src/Kerbalism/Modules/Greenhouse.cs`.
 *
 * `natural` and `artificial` are NEVER summed or combined into one figure:
 * the real lighting gate is `natural + artificial >= light_tolerance`, so a
 * lamp only ever needs to cover the shortfall against the sun, not double
 * the total. Presenting a combined number would misrepresent that as "more
 * light is always better," when a bright lamp on an already-lit greenhouse
 * contributes nothing the sun wasn't already providing.
 *
 * NOT YET fed by live data: `GonogoKerbalismUplink`'s capture pipeline does
 * not populate `kerbalism.lifesupport.greenhouses` yet, see
 * `KerbalismLifeSupport.Greenhouses`'s own doc comment in
 * `mod/Sitrep.Contract/KerbalismPayloads.cs`. This section is wired and
 * fixture-tested against the wire shape now so the mod-side capture has
 * something real to land into; on an unmodified Kerbalism install today the
 * field arrives as `undefined`, the widget's own `useLifeSupport` treats
 * that as "no greenhouse fitted," and this component's early return means
 * the slot renders nothing, exactly like a vessel with no greenhouse part.
 */

/** One active Greenhouse part's growing state, the shape the host widget
 *  passes down as this slot's props. */
export interface GreenhouseRow {
  cropResource: string;
  /** Natural light flux reaching the greenhouse, W/m^2. */
  natural: number;
  /** Supplemental lamp light flux, W/m^2. */
  artificial: number;
  /** The player's own on/off toggle, independent of whether it is currently producing. */
  active: boolean;
  /** Blocking reason string, e.g. "insufficient lighting". Empty when growing normally. */
  issue: string;
  /** Derived continuous production rate, units/s (0 when inactive or blocked). */
  foodRatePerSec: number;
}

export interface LifeSupportSlotContext {
  /** Active Greenhouse parts on the vessel; empty when none are fitted. */
  greenhouses: readonly GreenhouseRow[];
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "life-support.sections": LifeSupportSlotContext;
  }
}

function fmtWm2(n: number): string {
  return `${Math.round(n)} W/m²`;
}

/** Converts the per-second production rate to a per-day figure, more
 *  legible than a tiny per-second fraction for a continuous crop process. */
function fmtRatePerDay(perSec: number): string {
  if (perSec <= 0) return "0/day";
  const perDay = perSec * 86400;
  return `${perDay >= 10 ? perDay.toFixed(0) : perDay.toFixed(2)}/day`;
}

function greenhouseTone(g: GreenhouseRow): BadgeTone {
  if (!g.active) return "neutral";
  return g.issue.length > 0 ? "warn" : "go";
}

function greenhouseStateLabel(g: GreenhouseRow): string {
  if (!g.active) return "Off";
  return g.issue.length > 0 ? "Blocked" : "Growing";
}

/**
 * ONE greenhouse entry, rendered in the same two-line-per-item budget as the
 * Processes section above it (a title/badge row + a single compact value
 * line) so a fully-populated widget (broken process + habitat detail +
 * greenhouse + power) still fits the default grid size without pushing the
 * Power meter below the fold. A single-vessel-greenhouse widget, by far the
 * common case, costs exactly 2 lines (3 when blocked).
 */
function GreenhouseEntryRow({
  g,
  titlePrefix,
}: {
  g: GreenhouseRow;
  /** "Greenhouse" for the single-entry case, or the crop name when there are several. */
  titlePrefix: string;
}) {
  const blocked = g.active && g.issue.length > 0;
  return (
    <Row>
      <RowHead>
        <RowTitle>{titlePrefix}</RowTitle>
        <Badge
          role="status"
          aria-live="polite"
          tone={greenhouseTone(g)}
          size="sm"
        >
          {greenhouseStateLabel(g)}
        </Badge>
      </RowHead>
      <ValueLine>
        Natural {fmtWm2(g.natural)} · Artificial {fmtWm2(g.artificial)} · Rate{" "}
        {fmtRatePerDay(g.foodRatePerSec)}
      </ValueLine>
      {blocked && <IssueText>{g.issue}</IssueText>}
    </Row>
  );
}

function GreenhouseSection({ greenhouses }: LifeSupportSlotContext) {
  // No greenhouse part on the vessel, the common case. Render nothing
  // rather than an empty "Greenhouse" header with no content beneath it.
  if (greenhouses.length === 0) return null;
  // The overwhelmingly common case is exactly one greenhouse part: fold the
  // section identity straight into that one row's title ("Greenhouse")
  // instead of spending a whole extra line on a header no one needs. Only a
  // multi-greenhouse vessel (rare) gets a shared header, with each row then
  // titled by its own crop.
  if (greenhouses.length === 1) {
    return (
      <Wrap>
        <GreenhouseEntryRow g={greenhouses[0]} titlePrefix="Greenhouse" />
      </Wrap>
    );
  }
  return (
    <Wrap>
      <SectionLabel>Greenhouses</SectionLabel>
      {greenhouses.map((g, i) => (
        <GreenhouseEntryRow
          // biome-ignore lint/suspicious/noArrayIndexKey: greenhouse parts carry no stable id on the wire yet
          key={`${g.cropResource}-${i}`}
          g={g}
          titlePrefix={g.cropResource}
        />
      ))}
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-6);
`;

const SectionLabel = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const Row = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const RowHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
`;

const RowTitle = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

const ValueLine = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  /* Wraps rather than truncating with an ellipsis at narrow widths, a
     hidden number is worse than an extra line. */
`;

const IssueText = styled.span`
  font-size: var(--font-size-xs);
  /* "-fg" (not "-fg-muted") is meant to sit on the warning "-bg" background
     (e.g. inside a Badge), using it for standalone text on the Panel's dark
     background renders as near-black-on-black. The "-muted" variant is the
     one other widgets use for warning-toned text directly on a dark surface
     (LaunchDirector, CommSignal, DeployedScience). */
  color: var(--color-status-warning-fg-muted);
`;

registerAugment({
  id: "life-support-greenhouse",
  augments: "life-support.sections",
  component: GreenhouseSection,
});

export { GreenhouseSection };
