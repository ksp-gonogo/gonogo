import type { ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  judgeable,
  registerComponent,
  useProcessor,
  useTelemetry,
  useUtNow,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  Disclosure,
  DivergingBar,
  Divider,
  EmptyState,
  Grid,
  Meter,
  MeterStack,
  Panel,
  Section,
  type Severity,
  Stack,
  severityFromBadgeTone,
  speakQuantity,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import type {
  KerbalismGreenhouseEntry,
  KerbalismHabitat,
  KerbalismProcessEntry,
  KerbalismSpaceWeather,
} from "../__generated__/contract";
import {
  buildLedger,
  type Ledger,
  mag,
  type ResourceRow,
  type WearRow,
} from "../ecosystem";
import { SHIP_SYSTEMS, type ShipSystems } from "../processor";
import { KERBALISM } from "../uplink";
// Side-effect import: registers the `life-support.sections` augment filler
// (the Greenhouse section) and the SlotRegistry declaration merge for that
// slot id, see that file's own doc comment. Life support is a Kerbalism
// concept, so this augment lives here in the Uplink (not
// `@ksp-gonogo/components`), replacing the deleted `LifeSupportSystems`
// widget that used to own it.
import "./GreenhouseSection";
import { radiationTooHigh } from "./GreenhouseSection";
import { RadiationSection } from "./RadiationSection";
import { useResourceColorMap } from "./resourceColorMap";

type ShipSystemsConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// Tone + format helpers. `Tone` mirrors the vocabulary `Meter`/`Value`/
// `Badge` (via `severityFromBadgeTone`) already speak; nothing here invents a
// second colour system.
//
// `neutral` is the RESTING tone, and it is load-bearing (operator feedback:
// "the mix of colours everywhere ... is what makes it nauseating"). A status
// tone means something is WRONG; a healthy reading renders quiet grey, and
// its level is carried by the bar's fill fraction plus the text beside it,
// never by paint. In particular a LEVEL alone is not a status: a steady
// half-empty tank, or a nearly-empty waste container, is a fact, not an
// alarm, so tones escalate only off an actual drain, a diagnosis role, or an
// explicit low-threshold flag.
// ---------------------------------------------------------------------------

type Tone = "neutral" | "go" | "info" | "warn" | "nogo";

/**
 * Below this many seconds to empty, a resource is treated as critical
 * regardless of its fraction: a nearly-full tank draining in 90 seconds is a
 * worse emergency than a half-empty one draining over a week. Ten minutes:
 * long enough that the meter isn't screaming over a normal warp-time
 * transient, short enough that it fires with time left to actually act.
 */
const SOON_EMPTY_SEC = 600;

/** Whole numbers drop decimals; smaller values keep enough precision to read. */
export function fmtAmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  // Collapse to a bare integer only when it does not ERASE a nonzero value:
  // rounding e.g. -0.01 to "0" would hide a real (small) drain, which is
  // exactly the rate an operator opens the ledger to read.
  if (Math.abs(n - rounded) < 0.05 && !(rounded === 0 && n !== 0)) {
    return String(rounded);
  }
  return Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
}

/** "steady" while flat/filling; otherwise a spoken countdown, for `aria-valuetext`. */
function formatTimeToEmpty(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "steady";
  return speakQuantity(value("s", Math.max(0, sec)));
}

/** Signed rate, e.g. "+0.12/s" / "-1.4/s" / "0/s". */
function formatRate(perSecond: number): string {
  if (!Number.isFinite(perSecond) || perSecond === 0) return "0/s";
  const sign = perSecond > 0 ? "+" : "";
  return `${sign}${fmtAmt(perSecond)}/s`;
}

/**
 * A root cause is always the worst tone (it's the thing to act on); a
 * downstream shortage that isn't itself draining fast still reads as at
 * least a warning, because it is genuinely blocked. Beyond those and the
 * profile's own low-threshold flag, only a resource that is actually
 * DRAINING low earns a tone: a steady tank is quiet whatever its level
 * (an empty waste container rendering alarm-red was this function's own
 * defect: empty waste is good).
 */
function toneForRow(row: ResourceRow): Tone {
  if (row.role === "root") return "nogo";
  if (row.secondsToEmpty !== null && row.secondsToEmpty < SOON_EMPTY_SEC) {
    return "nogo";
  }
  if (row.belowLowThreshold === true) return "warn";
  if (row.role === "downstream") return "warn";
  if (
    row.secondsToEmpty !== null &&
    row.fraction !== null &&
    row.fraction < 0.2
  ) {
    return "warn";
  }
  return "neutral";
}

/** "12 / 40 · 3m 20s" style meter caption; "not fitted" for a tankless resource.
 *  Kept as a plain string for `Meter`'s `aria-valuetext` (an attribute, so it
 *  can only hold text); the visible header reads `RowValueDisplay` instead,
 *  which renders the same content through `<Unit>`. */
function rowValueLabel(row: ResourceRow): string {
  if (row.capacity <= 0) return "not fitted";
  return `${fmtAmt(row.amount)} / ${fmtAmt(row.capacity)} · ${formatTimeToEmpty(row.secondsToEmpty)}`;
}

/** Visible counterpart to `rowValueLabel`: same "amount / capacity · time"
 *  shape, but the time-to-empty renders through `<Unit>` (the canonical
 *  duration path, `formatQuantity` → `formatDuration`) instead of the
 *  hand-rolled `speakQuantity` string that function returns. */
function RowValueDisplay({ row }: { row: ResourceRow }) {
  if (row.capacity <= 0) return <>not fitted</>;
  const sec = row.secondsToEmpty;
  return (
    <>
      {fmtAmt(row.amount)} / {fmtAmt(row.capacity)} ·{" "}
      {sec == null || !Number.isFinite(sec) ? (
        "steady"
      ) : (
        <Unit value={value("s", Math.max(0, sec))} />
      )}
    </>
  );
}

/** Same resting-tone rule as `toneForRow`: wear is always slowly draining by
 *  nature, so the countdown does the alarming and the fraction only warns at
 *  the genuinely-low tail. "69 days left" in amber was tone inflation. */
function wearTone(w: WearRow): Tone {
  if (w.secondsRemaining !== null && w.secondsRemaining < SOON_EMPTY_SEC) {
    return "nogo";
  }
  if (w.fraction !== null && w.fraction < 0.2) return "warn";
  return "neutral";
}

function wearValueLabel(w: WearRow): string {
  if (w.capacity <= 0) return "not fitted";
  return `${fmtAmt(w.amount)} / ${fmtAmt(w.capacity)} · ${formatTimeToEmpty(w.secondsRemaining)}`;
}

type ProcessRunState = "idle" | "running" | "broken";

interface ProcessRow {
  id: string;
  name: string;
  state: ProcessRunState;
}

function toProcessRow(p: KerbalismProcessEntry, index: number): ProcessRow {
  return {
    id: p.resource || p.title || `process-${index}`,
    name: p.title || p.resource || "Process",
    state: p.broken ? "broken" : p.running ? "running" : "idle",
  };
}

/** Only a BROKEN process carries a severity; running and idle are both
 *  ordinary operating states and render as decorative grey chips (severity
 *  omitted), so a healthy process list adds no colour at all. */
function processSeverity(state: ProcessRunState): Severity | undefined {
  return state === "broken" ? "critical" : undefined;
}

/** Mirrors GreenhouseSection's own `GreenhouseRow`, ported field-for-field so
 *  the existing `life-support.sections` augment (see the slot render site's
 *  own doc comment below) keeps rendering unchanged. */
interface GreenhouseRow {
  cropResource: string;
  natural: number;
  artificial: number;
  active: boolean;
  issue: string;
  foodRatePerSec: number;
  /** rad/s. `<= 0` means "not reported", the same "not fitted" convention
   *  `row.capacity <= 0` uses elsewhere in this file: never flag against it. */
  radiationToleranceRadPerSec: number;
}

function toGreenhouseRow(g: KerbalismGreenhouseEntry): GreenhouseRow {
  return {
    cropResource: g.cropResource || "Food",
    natural: mag(g.natural),
    artificial: mag(g.artificial),
    active: g.active ?? false,
    issue: g.issue ?? "",
    radiationToleranceRadPerSec: mag(g.radiationToleranceRadPerSec),
    foodRatePerSec: mag(g.foodRatePerSec),
  };
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function ShipSystemsComponent(
  _props: Readonly<ComponentProps<ShipSystemsConfig>>,
) {
  const ship = useProcessor(SHIP_SYSTEMS);
  // Read outside the Processor (unlike the four `kerbalism.profile`/
  // `lifesupport`/resources/crew deps `SHIP_SYSTEMS` already shares with the
  // panel badge): nothing else in this widget's own render derives from
  // `kerbalism.spaceweather`, so a second Processor dependant is not worth
  // adding for one section. Read unconditionally, ahead of both early
  // returns below, to keep hook order stable.
  // Radiation and storm state are judgements: the operator reads them as the
  // situation now, so a held figure would understate an exposure that has since
  // risen.
  const weather = judgeable(useTelemetry("kerbalism.spaceweather"));
  const utNow = useUtNow();

  if (!ship) {
    return (
      <Panel panelTitle="Ship Systems">
        <EmptyState layout="fill" role="status" aria-live="polite">
          Waiting for Kerbalism telemetry...
        </EmptyState>
      </Panel>
    );
  }

  const { summary } = ship;
  const hasAnyResource =
    summary.supplies.length > 0 ||
    summary.other.length > 0 ||
    summary.wear.length > 0;
  if (!hasAnyResource) {
    return (
      <Panel panelTitle="Ship Systems">
        <EmptyState layout="fill" role="status" aria-live="polite">
          No Kerbalism profile reported for this vessel yet.
        </EmptyState>
      </Panel>
    );
  }

  return <ShipSystemsBody ship={ship} weather={weather} utNow={utNow} />;
}

/**
 * The single header pill. A halted greenhouse folds in HERE (as Degraded)
 * rather than raising a second "System halted" pill beside this one:
 * operator feedback called the two-pill header a colour pile-up, and a
 * recoverable subsystem halt is exactly what the Degraded rung means. The
 * greenhouse's own row still names the specific halt.
 */
function overallStatus(
  ship: ShipSystems,
  anyGreenhouseHalted: boolean,
): { label: string; tone: Tone } {
  if (ship.summary.causes.length > 0)
    return { label: "Critical", tone: "nogo" };
  const tones = ship.summary.supplies.map(toneForRow);
  if (tones.includes("nogo")) return { label: "Critical", tone: "nogo" };
  if (tones.includes("warn") || anyGreenhouseHalted)
    return { label: "Degraded", tone: "warn" };
  return { label: "Nominal", tone: "go" };
}

function ShipSystemsBody({
  ship,
  weather,
  utNow,
}: {
  ship: ShipSystems;
  weather: KerbalismSpaceWeather | undefined;
  utNow: number | undefined;
}) {
  const { summary } = ship;
  // The "Limiting factors" banner names a cause's ROOT resource but the
  // sentence's subject is the resource it explains (see `LimitedByMessage`),
  // so its own time-to-empty has to come from that OTHER row, not the
  // cause's. displayName is unique per profile (it is the key the operator
  // reads by), so it is a safe lookup key here.
  const rowsByDisplayName = new Map(
    [...summary.supplies, ...summary.other].map((r) => [r.displayName, r]),
  );
  const habitat: KerbalismHabitat | undefined = ship.lifeSupport?.habitat;
  const processes = (ship.lifeSupport?.processes ?? []).map(toProcessRow);
  const greenhouses = (ship.lifeSupport?.greenhouses ?? []).map(
    toGreenhouseRow,
  );
  // Ambient, not habitat/shielded: a greenhouse part's own tolerance is an
  // exposure limit on what's hitting the HULL, not the crew-shielded figure
  // (see the per-row threshold check this feeds, below).
  const ambientRadiationRadPerSecond = mag(weather?.radiationRadPerSecond);

  // The power footer: ElectricCharge is universal across every Kerbalism
  // profile (stock and RO both declare it), so it is worth a permanently
  // visible readout the way the old widget's hardcoded Power meter was,
  // even though it is ALSO just another row in `summary.supplies` above.
  // Duplicating the reading rather than special-casing its layout only
  // matches the "spending funds: always show the balance" duplication
  // convention elsewhere in this codebase: the operator should not have to
  // scroll to find the one number that ends the mission.
  const ecRow =
    summary.supplies.find((r) => r.name === "ElectricCharge") ??
    summary.other.find((r) => r.name === "ElectricCharge");

  const runningCount = processes.filter((p) => p.state === "running").length;
  const brokenCount = processes.filter((p) => p.state === "broken").length;
  const processSummary =
    brokenCount > 0
      ? `${runningCount} running · ${brokenCount} broken`
      : `${runningCount} / ${processes.length} running`;

  const pressurized = mag(habitat?.pressure) > 0.5;

  // A halted greenhouse is a WIDGET-level event, not just a per-row one: it
  // folds into the header status (see `overallStatus`) so an operator
  // scanning the panel header still catches it without a second pill.
  const anyGreenhouseHalted = greenhouses.some((g) =>
    radiationTooHigh(g, ambientRadiationRadPerSecond),
  );
  const status = overallStatus(ship, anyGreenhouseHalted);

  // Every resource this render pass shows a Card for, supplies and other
  // alike: one colour map covers both sections so the same resource always
  // strips the same colour regardless of which bucket `summarise` sorted it
  // into.
  const resourceColors = useResourceColorMap([
    ...summary.supplies.map((r) => r.name),
    ...summary.other.map((r) => r.name),
  ]);

  return (
    <Panel
      panelTitle="Ship Systems"
      panelAside={
        <Badge
          role="status"
          aria-live="polite"
          severity={severityFromBadgeTone(status.tone)}
        >
          {status.label}
        </Badge>
      }
      panelFooter={
        // The power footer, PINNED below the scroller by the Panel itself
        // (not merely rendered last, which still scrolled away with the
        // body): ElectricCharge is universal across every Kerbalism profile,
        // so it earns the one permanently visible readout, the same
        // "duplicate the balance next to where it matters" convention the
        // funds rule uses. Rendered only when the profile carries EC.
        ecRow && (
          <Meter
            label="Power"
            value={ecRow.fraction ?? 0}
            tone={toneForRow(ecRow)}
            valueLabel={rowValueLabel(ecRow)}
            valueLabelNode={<RowValueDisplay row={ecRow} />}
            size="md"
          />
        )
      }
    >
      <Stack gap="md">
        {/* Radiation leads the widget: the operator's own call, it is the
            attractive visual (the sparkline trend), so it earns the top
            slot rather than sitting below the resource ledger. Renders
            nothing when no spaceweather frame has ever landed, matching
            RadiationSection's own contract. */}
        {weather && (
          <Section>
            <SectionHead label="Radiation" />
            <RadiationSection weather={weather} utNow={utNow} />
          </Section>
        )}

        {summary.causes.length > 0 && (
          // Card, matching every other container in this widget now
          // (operator feedback: the widget used to hand-stitch `Box`
          // inconsistently, some rows boxed, some not).
          <Card role="status" aria-live="polite">
            <Stack gap="xs">
              <Value tone="nogo" weight="semibold" size="sm">
                Limiting factors
              </Value>
              {summary.causes.flatMap((cause) =>
                cause.explains.length > 0
                  ? cause.explains.map((explained) => {
                      const explainedRow = rowsByDisplayName.get(explained);
                      return (
                        <Value
                          key={`${cause.name}-${explained}`}
                          tone="nogo"
                          size="xs"
                        >
                          <LimitedByMessage
                            subjectDisplayName={explained}
                            blockedBy={[cause.displayName]}
                            secondsToEmpty={
                              explainedRow?.secondsToEmpty ?? null
                            }
                          />
                        </Value>
                      );
                    })
                  : [
                      <Value key={cause.name} tone="nogo" size="xs">
                        {cause.displayName} is running critically low
                        {cause.secondsToEmpty !== null && (
                          <>
                            {" "}
                            (~
                            <Unit
                              value={value(
                                "s",
                                Math.max(0, cause.secondsToEmpty),
                              )}
                            />{" "}
                            left)
                          </>
                        )}
                      </Value>,
                    ],
              )}
            </Stack>
          </Card>
        )}

        <Section>
          <SectionHead label="Supplies" />
          <MeterStack>
            {summary.supplies.map((row) => (
              <ResourceLedgerRow
                key={row.name}
                row={row}
                ship={ship}
                categoryColor={resourceColors.get(row.name)}
              />
            ))}
          </MeterStack>
        </Section>

        {summary.other.length > 0 && (
          <Section>
            <SectionHead label="Other resources" />
            <MeterStack>
              {summary.other.map((row) => (
                <ResourceLedgerRow
                  key={row.name}
                  row={row}
                  ship={ship}
                  categoryColor={resourceColors.get(row.name)}
                />
              ))}
            </MeterStack>
          </Section>
        )}

        {summary.wear.length > 0 && (
          <Section>
            <SectionHead label="Wear" />
            <MeterStack>
              {summary.wear.map((w) => (
                <Meter
                  key={w.name}
                  label={w.process}
                  value={w.fraction ?? 0}
                  tone={wearTone(w)}
                  valueLabel={wearValueLabel(w)}
                  size="sm"
                />
              ))}
            </MeterStack>
          </Section>
        )}

        <Section>
          <SectionHead
            label="Habitat"
            value={pressurized ? "Pressurized" : "Unpressurized"}
            tone={pressurized ? "go" : "warn"}
          />
          {/* A real grid, not a wrapping Cluster: `Meter` is `width: 100%`,
              so as flex items the three meters each claimed a full row and
              the "cluster" was three stacked bars at every width. Grid
              tracks give them even side-by-side columns wherever the panel
              is wide enough and a clean stack where it isn't. */}
          <Grid minColWidth="10rem" gap="md">
            <Meter
              label="Comfort"
              value={mag(habitat?.comfort)}
              tone={mag(habitat?.comfort) < 0.25 ? "warn" : "neutral"}
              size="sm"
            />
            <Meter
              label="Living space"
              value={mag(habitat?.livingSpace)}
              tone="neutral"
              size="sm"
            />
            <Meter
              label="CO2 poisoning"
              value={mag(habitat?.poisoning)}
              tone={mag(habitat?.poisoning) >= 0.5 ? "nogo" : "neutral"}
              size="sm"
            />
          </Grid>
        </Section>

        <Section>
          <SectionHead
            label="Processes"
            value={processSummary}
            tone={brokenCount > 0 ? "nogo" : "go"}
          />
          <Stack gap="xs">
            {processes.map((p) => (
              <Cluster key={p.id} justify="between">
                <Value tone="default" size="xs">
                  {p.name}
                </Value>
                <Badge severity={processSeverity(p.state)} size="sm">
                  {p.state}
                </Badge>
              </Cluster>
            ))}
          </Stack>
        </Section>

        {/* The built-in Greenhouse readout (this package's own
            GreenhouseSection, moved here alongside the Ship Systems rebuild
            when the old LifeSupportSystems widget was deleted) fills this
            slot: it self-registers into `life-support.sections` via the
            side-effect import above. */}
        <AugmentSlot
          name="life-support.sections"
          props={{ greenhouses, ambientRadiationRadPerSecond }}
        />
      </Stack>
    </Panel>
  );
}

function SectionHead({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string;
  tone?: Tone;
}) {
  return (
    <Cluster justify="between" align="baseline">
      <Value tone="muted" size="xs">
        {label.toUpperCase()}
      </Value>
      {value !== undefined && (
        // `neutral` is a Meter/Badge tone, not a Value one: a resting
        // section reading renders in the same muted text as the label.
        <Value
          tone={tone === undefined || tone === "neutral" ? "muted" : tone}
          size="xs"
        >
          {value}
        </Value>
      )}
    </Cluster>
  );
}

/**
 * One resource row: a `Meter` on its own full-width line (never squeezed
 * against the disclosure trigger, the narrow-width overlap operators hit),
 * an optional "X limited by Y" footnote naming THIS row's resource as the
 * subject and its blocker as the object (never the reverse: a root cause's
 * own row carries no footnote, since nothing blocks it, `diagnose` says so
 * via an empty `blockedBy`), and an accessible `variant="inline"` accordion
 * revealing the per-source rate ledger (`buildLedger`, a click-time pure
 * call over the already-carried profile/lifeSupport/crew, never re-derived
 * by the Processor). `inline` expands the ledger in flow below the trigger,
 * so it pushes the row taller instead of overlaying whatever follows.
 */
function ResourceLedgerRow({
  row,
  ship,
  categoryColor,
}: {
  row: ResourceRow;
  ship: ShipSystems;
  /** This resource's colour from `useResourceColorMap`, rendered as the
   *  Card's top-edge identity strip. `undefined` renders no strip (the
   *  colour map is always populated for a row present in `summary`, this
   *  is just the prop's own honest optionality). */
  categoryColor?: string;
}) {
  const ledger = useMemo<Ledger>(
    () =>
      buildLedger({
        resource: row.name,
        profile: ship.profile,
        lifeSupport: ship.lifeSupport,
        crew: ship.crew,
      }),
    [row.name, ship.profile, ship.lifeSupport, ship.crew],
  );

  return (
    // testid escape hatch: a plain visual container, no role/label of its
    // own to query by (the Meter it wraps already carries the accessible
    // name), so a stable hook is the only way a test can reach THIS row's
    // own Card to assert its categoryColor strip.
    <Card
      categoryColor={categoryColor}
      data-testid={`resource-card-${row.name}`}
    >
      <Stack gap="sm">
        <Meter
          label={row.displayName}
          value={row.fraction ?? 0}
          tone={toneForRow(row)}
          valueLabel={rowValueLabel(row)}
          valueLabelNode={<RowValueDisplay row={row} />}
          size="sm"
        />
        {row.role === "downstream" && row.blockedBy.length > 0 && (
          // `tone="warn"` alone renders --color-status-warning-fg, a
          // near-black meant for text ON the warning "-bg" orange, e.g.
          // inside a Badge. Standalone on this row's dark surface that is
          // functionally invisible. The `-fg-muted` override is the same
          // fix GreenhouseSection.tsx documents for the identical landmine
          // (LaunchDirector, CommSignal, DeployedScience hit it too).
          <Value
            tone="warn"
            size="xs"
            style={{ color: "var(--color-status-warning-fg-muted)" }}
          >
            <LimitedByMessage
              subjectDisplayName={row.displayName}
              blockedBy={row.blockedBy}
              secondsToEmpty={row.secondsToEmpty}
            />
          </Value>
        )}
        {/* Chevron-only: five worded "Show detail" buttons in one column
            read as five competing controls (operator feedback). The rotating
            chevron is the whole affordance; the aria-label still names what
            it reveals. */}
        <Disclosure
          variant="inline"
          asButton
          buttonSize="sm"
          label={null}
          ariaLabel={`Show rate breakdown for ${row.displayName}`}
        >
          <LedgerBody ledger={ledger} />
        </Disclosure>
      </Stack>
    </Card>
  );
}

/**
 * "<subject> is being limited by <blockers>", the resource in shortage named
 * first because that is what an operator is trying to fix, followed by a
 * prediction of how long THAT resource (never the blocker) has left. Shared
 * by the per-row footnote and the panel-level "Limiting factors" banner so
 * the two never drift into different phrasings for the same diagnosis.
 */
function LimitedByMessage({
  subjectDisplayName,
  blockedBy,
  secondsToEmpty,
}: {
  subjectDisplayName: string;
  blockedBy: string[];
  secondsToEmpty: number | null;
}) {
  return (
    <>
      {subjectDisplayName} is being limited by {blockedBy.join(", ")}.
      {secondsToEmpty !== null && (
        <>
          {" "}
          ~<Unit value={value("s", Math.max(0, secondsToEmpty))} /> of{" "}
          {subjectDisplayName} left
        </>
      )}
    </>
  );
}

function LedgerBody({ ledger }: { ledger: Ledger }) {
  const hasResidual =
    ledger.residual !== undefined && Math.abs(ledger.residual) > 1e-6;
  // Every bar in this ledger scales against the largest |rate| among ITS OWN
  // terms (never a cross-resource or cross-row scale), matching the
  // kerbalism-graph-mock prototype (`kerbalism-graph-mock/water-entity.html`)
  // `DivergingBar` ports the design from: the biggest term reaches the
  // half-bar mark, everything else is relative to it. 0 when there are no
  // terms (the "No modelled sources" branch never reaches `DivergingBar`).
  const maxAbsRate = Math.max(
    0,
    ...ledger.terms.map((t) => Math.abs(t.ratePerSecond)),
  );
  return (
    // No `minWidth`: a fixed floor here is exactly what used to force this
    // panel wider than the row that hosts it (see this component's own
    // history), spilling the ledger past the widget's right edge at any
    // width narrower than the floor. `width: 100%` lets it size to whatever
    // the accordion panel actually has, at every panel width down to
    // minSize.
    <Stack gap="xs" style={{ width: "100%", minWidth: 0 }}>
      {ledger.terms.length === 0 ? (
        <Value tone="muted" size="xs">
          No modelled sources
        </Value>
      ) : (
        ledger.terms.map((term) => (
          // `wrap`: the rate ("-0.01/s") is one unbreakable token (no space
          // for the browser's own text-wrap to catch), so once the term
          // NAME has shrunk as far as ITS wrapping allows, the rate has
          // nowhere left to shrink to. Flex-wrapping the row lets the
          // trailing group drop to a line of its own at the narrowest panel
          // widths instead of forcing the row (and everything above it)
          // wider than the panel, which is exactly the overflow this
          // component used to have (see this function's own doc comment).
          <Cluster
            key={`${term.kind}-${term.name}-${term.flightId ?? ""}`}
            justify="between"
            wrap
          >
            <Value tone="default" size="xs">
              {term.name}
            </Value>
            {/* Nested Cluster, not a bespoke row: groups the bar and the
                rate so the pair moves together as one item on the outer
                Cluster's trailing edge. `justify="start"` packs them at
                their own gap rather than spreading them across the (already
                content-sized) width `DivergingBar`'s own `flex: 0 0 auto`
                gives this inner row. */}
            <Cluster gap="xs" justify="start">
              <DivergingBar value={term.ratePerSecond} maxAbs={maxAbsRate} />
              {/* The DivergingBar already paints the sign; a red/green
                  NUMBER beside a red/green bar doubled the same reading and
                  fed the widget's colour pile-up. The signed prefix keeps
                  the direction legible in text. */}
              <Value tone="default" size="xs">
                {formatRate(term.ratePerSecond)}
              </Value>
            </Cluster>
          </Cluster>
        ))
      )}
      <Divider space="xs" />
      <Cluster justify="between" wrap>
        <Value tone="muted" size="xs">
          Net (derived)
        </Value>
        {/* tone="default", never the accent default: `Value`'s accent green
            on a NEGATIVE net read as "this drain is good". The sign prefix
            carries the direction. */}
        <Value tone="default" size="xs">
          {formatRate(ledger.derivedNet)}
        </Value>
      </Cluster>
      {ledger.reportedNet !== undefined && (
        <Cluster justify="between" wrap>
          <Value tone="muted" size="xs">
            Reported
          </Value>
          <Value tone="default" size="xs">
            {formatRate(ledger.reportedNet)}
          </Value>
        </Cluster>
      )}
      {hasResidual && ledger.residual !== undefined && (
        // Same near-black-on-dark landmine as the row footnote above: the
        // `-fg-muted` override keeps this readable on the panel surface.
        // Every term above is already scaled by Kerbalism's own live modifier
        // product (envModifier/ruleEnvModifiers, option a'), so this residual
        // is no longer "modifiers we didn't model" -- it is a genuine
        // model-vs-reality gap (timewarp catch-up between samples, a consumer
        // this ledger doesn't enumerate) and is worth keeping visible as
        // exactly that, never hidden.
        <Value
          tone="warn"
          size="xs"
          style={{ color: "var(--color-status-warning-fg-muted)" }}
        >
          Residual {formatRate(ledger.residual)} (unaccounted)
        </Value>
      )}
    </Stack>
  );
}

registerComponent<ShipSystemsConfig>({
  id: "ship-systems",
  name: "Ship Systems",
  description:
    "Vessel-wide Kerbalism resource ledger: root-cause diagnosis, every profile resource as a meter with a per-source rate ledger, wear gauges, habitat, processes, and the power meter.",
  tags: ["telemetry", "kerbalism"],
  defaultSize: { w: 9, h: 15 },
  minSize: { w: 4, h: 5 },
  component: ShipSystemsComponent,
  dataRequirements: [
    "kerbalism.profile",
    "kerbalism.lifesupport",
    "vessel.resources",
    "vessel.crew",
  ],
  channels: [
    "kerbalism.profile",
    "kerbalism.lifesupport",
    "vessel.resources",
    "vessel.crew",
  ],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
  // Reuses the `life-support.sections` slot id the deleted LifeSupportSystems
  // widget used to own (see the render-site comment above): the Greenhouse
  // augment, now living alongside this widget, fills it out of the box.
  augmentSlots: ["life-support.sections"],
  owner: KERBALISM,
});

export { ShipSystemsComponent };
