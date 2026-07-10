import type { ComponentProps } from "@gonogo/core";
import {
  AugmentSlot,
  getSizeBucket,
  getWidgetShape,
  registerComponent,
  useDataValue,
} from "@gonogo/core";
import {
  Badge,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
} from "@gonogo/ui";
import styled from "styled-components";

type StaffRosterConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// The `staff-roster.badges` slot contract (spec §4.4 / augment-slot-map)
//
// Whole-program roster analogue of `crew-manifest.badges`: a per-kerbal inline
// badges slot so a future Kerbalism `Habitat`/`Radiation` Uplink can badge each
// staff row with comfort/radiation-dose without leaving this widget. Because the
// slot renders once PER ROW, its props MUST carry the kerbal's identity so the
// augment badges the right one — `staffName` is that identity (kerbal names are
// the only per-kerbal handle Sitrep exposes here) and `staffIndex` disambiguates
// the (legal) case of two kerbals sharing a name.
// ---------------------------------------------------------------------------

/** Props passed to every `staff-roster.badges` augment — one per roster row. */
export interface StaffBadgeContext {
  /** The kerbal this badge row belongs to — its identity for the augment. */
  staffName: string;
  /** Position in the sorted roster; disambiguates duplicate names. */
  staffIndex: number;
}

// Declaration-merge the slot id → props type into core's `SlotRegistry` (spec
// §4.6). Co-located here (not in a shared central file) so parallel slot work in
// other widgets can't collide. Makes `registerAugment({ augments:
// "staff-roster.badges" })` and `<AugmentSlot name="staff-roster.badges"
// props={…} />` type-check precisely against `StaffBadgeContext`.
declare module "@gonogo/core" {
  interface SlotRegistry {
    "staff-roster.badges": StaffBadgeContext;
  }
}

export interface StaffMember {
  name: string;
  trait: string;
  experienceLevel: number;
  available: boolean;
  unavailableReason: string;
  // Expanded fields from kc.crewRoster — additive, default to safe
  // zero/false when the older Telemachus DLL is loaded.
  veteran: boolean;
  isBadass: boolean;
  careerFlights: number;
  courage: number;
  stupidity: number;
  currentVesselName: string;
}

/**
 * Defensive parser for `kc.crewRoster` from the GonogoTelemetry plugin.
 * Mirrors the shape used by the Launch Director's crew picker — same
 * payload, different consumer. Drops malformed entries; preserves the
 * `unavailableReason` string for tooltips on greyed rows.
 */
export function parseStaff(raw: unknown): StaffMember[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: StaffMember[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    out.push({
      name,
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel:
        typeof e.experienceLevel === "number" ? e.experienceLevel : 0,
      available: e.available === true,
      unavailableReason:
        typeof e.unavailableReason === "string" ? e.unavailableReason : "",
      veteran: e.veteran === true,
      isBadass: e.isBadass === true,
      careerFlights: typeof e.careerFlights === "number" ? e.careerFlights : 0,
      courage: typeof e.courage === "number" ? e.courage : 0,
      stupidity: typeof e.stupidity === "number" ? e.stupidity : 0,
      currentVesselName:
        typeof e.currentVesselName === "string" ? e.currentVesselName : "",
    });
  }
  return out;
}

const TRAIT_ORDER = ["Pilot", "Engineer", "Scientist", "Tourist"] as const;
const TRAIT_RANK: Record<string, number> = TRAIT_ORDER.reduce(
  (acc, t, i) => {
    acc[t] = i;
    return acc;
  },
  {} as Record<string, number>,
);

// Tooltip stitched from the expanded kc.crewRoster fields. Includes
// courage/stupidity (which we don't render as primary chrome to keep
// the row compact) and the current-vessel attribution for assigned
// kerbals — useful context the row otherwise loses.
function buildTooltip(k: StaffMember): string {
  const parts: string[] = [];
  parts.push(`${k.trait || "—"} · L${k.experienceLevel}`);
  if (k.careerFlights > 0) parts.push(`${k.careerFlights} flight(s)`);
  parts.push(`courage ${Math.round(k.courage * 100)}`);
  parts.push(`stupidity ${Math.round(k.stupidity * 100)}`);
  if (k.veteran) parts.push("veteran");
  if (k.isBadass) parts.push("badass");
  if (!k.available && k.unavailableReason) {
    if (k.currentVesselName)
      parts.push(`${k.unavailableReason} (${k.currentVesselName})`);
    else parts.push(k.unavailableReason);
  }
  return parts.join(" · ");
}

function sortStaff(roster: StaffMember[]): StaffMember[] {
  // Available kerbals first, then by trait (Pilot/Eng/Sci/Tourist), then
  // by experience desc, then alphabetical. Stable for equal keys.
  return [...roster].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const ar = TRAIT_RANK[a.trait] ?? 99;
    const br = TRAIT_RANK[b.trait] ?? 99;
    if (ar !== br) return ar - br;
    if (a.experienceLevel !== b.experienceLevel)
      return b.experienceLevel - a.experienceLevel;
    return a.name.localeCompare(b.name);
  });
}

function StaffRosterComponent({
  w,
  h,
}: Readonly<ComponentProps<StaffRosterConfig>>) {
  const rosterRaw = useDataValue("data", "kc.crewRoster");
  const staff = parseStaff(rosterRaw);

  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  const sizeBucket = getSizeBucket(w, h);
  // Wide-short boxes (landscape-18x5) leave a single-column list stranded with
  // a long empty gutter — only the shape signal can see that, since the size
  // bucket reads the same `normal` at 18x5 as at 5x18. Flow the rows into a
  // width-following multi-column grid only when landscape; portrait and square
  // keep the unchanged single column so those sizes can't regress.
  const { shape } = getWidgetShape(w, h);
  const multiColumn = shape === "landscape";

  if (staff === null) {
    return (
      <Panel>
        <PanelTitle>STAFF ROSTER</PanelTitle>
        {showSubtitle && (
          <PanelSubtitle>Awaiting roster telemetry</PanelSubtitle>
        )}
      </Panel>
    );
  }

  if (staff.length === 0) {
    return (
      <Panel>
        <PanelTitle>STAFF ROSTER</PanelTitle>
        {showSubtitle && (
          <PanelSubtitle>Roster empty — no kerbals hired.</PanelSubtitle>
        )}
      </Panel>
    );
  }

  const sorted = sortStaff(staff);
  const available = staff.filter((s) => s.available).length;
  const missing = staff.length - available;

  // Kerbal names aren't guaranteed unique across the roster (e.g. a re-hired
  // duplicate), so a name-only React key can collide. Build a stable composite
  // key from name + trait, suffixed with an occurrence count so two identical
  // (name, trait) pairs still get distinct, content-derived keys.
  const rowKeys: string[] = [];
  const seenKeyCounts = new Map<string, number>();
  for (const kerbal of sorted) {
    const base = `${kerbal.name}|${kerbal.trait}`;
    const n = seenKeyCounts.get(base) ?? 0;
    seenKeyCounts.set(base, n + 1);
    rowKeys.push(`${base}#${n}`);
  }

  if (sizeBucket === "tiny") {
    // The big count + label already fill the shortest tiny boxes (h<4 ≈ 75px
    // after the title). Showing the "N unavailable" line there overflows the
    // panel and only a clipped digit peeks out, so omit it below 4 rows and
    // keep it for the taller-but-narrow tiny boxes (e.g. 2×8) that have room.
    const showMissing = missing > 0 && rows >= 4;
    return (
      <Panel>
        <PanelTitle>STAFF</PanelTitle>
        <TinyBody role="status" aria-live="polite">
          <TinyCount>
            {available}
            <TinyTotal>/{staff.length}</TinyTotal>
          </TinyCount>
          <TinyLabel>available</TinyLabel>
          {showMissing && <TinyMissing>{missing} unavailable</TinyMissing>}
        </TinyBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>STAFF ROSTER</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {available}/{staff.length} available
        </PanelSubtitle>
      )}
      <Body>
        <List $multiColumn={multiColumn}>
          {sorted.map((kerbal, i) => (
            <Row
              key={rowKeys[i]}
              $available={kerbal.available}
              title={buildTooltip(kerbal)}
            >
              <Name>{kerbal.name}</Name>
              <Meta>
                <TraitTag title={`Trait: ${kerbal.trait || "Unknown"}`}>
                  {kerbal.trait || "—"}
                </TraitTag>
                <Level
                  title={`Experience level ${kerbal.experienceLevel}`}
                  aria-label={`Experience level ${kerbal.experienceLevel}`}
                >
                  L{kerbal.experienceLevel}
                </Level>
                {kerbal.veteran && (
                  <Badge
                    tone="go"
                    size="sm"
                    aria-label="veteran"
                    title="Veteran — has flown a notable mission"
                  >
                    ★
                  </Badge>
                )}
                {kerbal.isBadass && (
                  <Badge
                    tone="warn"
                    size="sm"
                    aria-label="badass"
                    title="Badass — KSP's brave trait; rarely panics"
                  >
                    BA
                  </Badge>
                )}
                {kerbal.careerFlights > 0 && (
                  <Badge
                    tone="neutral"
                    size="sm"
                    aria-label={`${kerbal.careerFlights} flights`}
                    title={`${kerbal.careerFlights} career flight${kerbal.careerFlights === 1 ? "" : "s"} completed`}
                  >
                    {kerbal.careerFlights}F
                  </Badge>
                )}
                {!kerbal.available && (
                  <Badge
                    tone="nogo"
                    size="sm"
                    title={
                      kerbal.currentVesselName
                        ? `${kerbal.unavailableReason || "Unavailable"} (${kerbal.currentVesselName})`
                        : kerbal.unavailableReason || "Unavailable"
                    }
                  >
                    {kerbal.unavailableReason || "Unavailable"}
                  </Badge>
                )}
                {/* Per-kerbal inline badges slot. Renders nothing until an Uplink
                    (e.g. Kerbalism Habitat/Radiation) binds — the props carry
                    this row's kerbal identity so the augment badges the right
                    one. */}
                <AugmentSlot
                  name="staff-roster.badges"
                  props={{ staffName: kerbal.name, staffIndex: i }}
                />
              </Meta>
            </Row>
          ))}
        </List>
      </Body>
    </Panel>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
`;

// Single column by default (portrait / square). In landscape we switch to a
// width-following grid: `auto-fill` + a min row width derives the column count
// from the available width rather than hardcoding a fixed "2 columns", so the
// same rule fills an 18-wide box with two columns and a 24-wide one with three.
const LIST_MIN_ROW_WIDTH = "160px";
const List = styled.ul<{ $multiColumn: boolean }>`
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 2px;
  ${({ $multiColumn }) =>
    $multiColumn
      ? `display: grid;
         grid-template-columns: repeat(auto-fill, minmax(${LIST_MIN_ROW_WIDTH}, 1fr));
         align-content: start;`
      : `display: flex;
         flex-direction: column;`}
`;

const Row = styled.li<{ $available: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
  padding: 4px 6px;
  border-radius: 2px;
  background: var(--color-surface-panel);
  opacity: ${(p) => (p.$available ? 1 : 0.5)};
`;

const Name = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Meta = styled.span`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
`;

const TraitTag = styled.span`
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  text-transform: uppercase;
`;

const Level = styled.span`
  font-size: 10px;
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const TinyBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px;
`;

const TinyCount = styled.div`
  font-size: 28px;
  font-weight: 600;
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  line-height: 1;
`;

const TinyTotal = styled.span`
  font-size: 16px;
  color: var(--color-text-muted);
  font-weight: 400;
`;

const TinyLabel = styled.span`
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const TinyMissing = styled.span`
  font-size: 10px;
  color: var(--color-status-nogo-fg);
  margin-top: 2px;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<StaffRosterConfig>({
  id: "staff-roster",
  name: "Staff Roster",
  description:
    "Whole-program kerbal roster sourced from kc.crewRoster — pilots, engineers, scientists, tourists. Sorted available-first then by trait + experience. Unavailable kerbals greyed with reason (Assigned / Hospitalised / etc.) in the tooltip. Cross-scene: works at SC, in flight, in editor.",
  tags: ["career", "crew"],
  defaultSize: { w: 5, h: 7 },
  minSize: { w: 2, h: 2 },
  component: StaffRosterComponent,
  // Per-kerbal inline badges slot (augment-slot-map: staff-roster.badges).
  // Unfilled until a Kerbalism-style Uplink binds — the roster renders as before.
  augmentSlots: ["staff-roster.badges"],
  dataRequirements: ["kc.crewRoster"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { StaffRosterComponent };
