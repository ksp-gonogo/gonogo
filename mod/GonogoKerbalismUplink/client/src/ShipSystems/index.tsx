import type {
  ComponentProps,
  KerbalismGreenhouseEntry,
  KerbalismHabitat,
  KerbalismProcessEntry,
  KerbalismSpaceWeather,
} from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  registerComponent,
  useProcessor,
  useTelemetry,
  useUtNow,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Box,
  Cluster,
  Disclosure,
  DivergingBar,
  Divider,
  EmptyState,
  Meter,
  MeterStack,
  Panel,
  Section,
  Stack,
  severityFromBadgeTone,
  speakQuantity,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useMemo } from "react";
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
import { RadiationSection } from "./RadiationSection";

type ShipSystemsConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// Tone + format helpers. `Tone` mirrors the vocabulary `Meter`/`Value`/
// `Badge` (via `severityFromBadgeTone`) already speak; nothing here invents a
// second colour system.
// ---------------------------------------------------------------------------

type Tone = "go" | "info" | "warn" | "nogo";

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
 * least a warning, because it is genuinely blocked. Otherwise falls back to
 * the profile's own low-threshold call, then a plain fraction read.
 */
function toneForRow(row: ResourceRow): Tone {
  if (row.role === "root") return "nogo";
  if (row.secondsToEmpty !== null && row.secondsToEmpty < SOON_EMPTY_SEC) {
    return "nogo";
  }
  if (row.belowLowThreshold === true) return "warn";
  if (row.role === "downstream") return "warn";
  if (row.fraction === null) return "info";
  if (row.fraction >= 0.5) return "go";
  if (row.fraction >= 0.2) return "warn";
  return "nogo";
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

function wearTone(w: WearRow): Tone {
  if (w.secondsRemaining !== null && w.secondsRemaining < SOON_EMPTY_SEC) {
    return "nogo";
  }
  if (w.fraction === null) return "info";
  if (w.fraction >= 0.5) return "go";
  if (w.fraction >= 0.2) return "warn";
  return "nogo";
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

function processTone(state: ProcessRunState): Tone {
  if (state === "broken") return "nogo";
  if (state === "running") return "go";
  return "info";
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
  const weather = useTelemetry("kerbalism.spaceweather");
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

function overallStatus(ship: ShipSystems): { label: string; tone: Tone } {
  if (ship.summary.causes.length > 0)
    return { label: "Critical", tone: "nogo" };
  const tones = ship.summary.supplies.map(toneForRow);
  if (tones.includes("nogo")) return { label: "Critical", tone: "nogo" };
  if (tones.includes("warn")) return { label: "Degraded", tone: "warn" };
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
  const status = overallStatus(ship);
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
    >
      <Stack gap="md">
        {summary.causes.length > 0 && (
          // No `surface`: this used to sit on `sunken` (a near-black tile
          // that visually detached from the rest of the panel). Transparent
          // lets it sit on the Panel's own surface like every other block.
          <Box pad="md" radius="sm" role="status" aria-live="polite">
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
          </Box>
        )}

        <Section>
          <SectionHead label="Supplies" />
          <MeterStack>
            {summary.supplies.map((row) => (
              <ResourceLedgerRow key={row.name} row={row} ship={ship} />
            ))}
          </MeterStack>
        </Section>

        {summary.other.length > 0 && (
          <Section>
            <SectionHead label="Other resources" />
            <MeterStack>
              {summary.other.map((row) => (
                <ResourceLedgerRow key={row.name} row={row} ship={ship} />
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
          <Cluster gap="md" wrap>
            <Meter
              label="Comfort"
              value={mag(habitat?.comfort)}
              tone={mag(habitat?.comfort) >= 0.5 ? "go" : "warn"}
              size="sm"
            />
            <Meter
              label="Living space"
              value={mag(habitat?.livingSpace)}
              tone="info"
              size="sm"
            />
            <Meter
              label="CO2 poisoning"
              value={mag(habitat?.poisoning)}
              tone={mag(habitat?.poisoning) >= 0.5 ? "nogo" : "go"}
              size="sm"
            />
          </Cluster>
        </Section>

        {weather && (
          <Section>
            <SectionHead label="Radiation" />
            <RadiationSection weather={weather} utNow={utNow} />
          </Section>
        )}

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
                <Badge
                  severity={severityFromBadgeTone(processTone(p.state))}
                  size="sm"
                >
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

      {ecRow && (
        <FooterRow>
          <Meter
            label="Power"
            value={ecRow.fraction ?? 0}
            tone={toneForRow(ecRow)}
            valueLabel={rowValueLabel(ecRow)}
            valueLabelNode={<RowValueDisplay row={ecRow} />}
            size="md"
          />
        </FooterRow>
      )}
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
        <Value tone={tone ?? "muted"} size="xs">
          {value}
        </Value>
      )}
    </Cluster>
  );
}

/** Not a styled component: a plain flex footer pinned below the scrolling
 *  Stack, matching the old widget's `marginTop: auto` footer convention with
 *  ui-kit's own Box primitive instead of a bespoke styled.div. */
function FooterRow({ children }: { children: ReactNode }) {
  return (
    <Box pad={["sm", "md"]} bordered={false}>
      {children}
    </Box>
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
}: {
  row: ResourceRow;
  ship: ShipSystems;
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
    // pad="md": pad="sm" (4px) still read as cramped once the meter, the
    // footnote, and the disclosure trigger were all stacked in one block.
    <Box pad="md" surface="raised" radius="sm">
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
        <Disclosure
          variant="inline"
          chevron={false}
          asButton
          buttonSize="sm"
          label={(open) => (open ? "Hide detail" : "Show detail")}
          ariaLabel={`Show rate breakdown for ${row.displayName}`}
        >
          <LedgerBody ledger={ledger} />
        </Disclosure>
      </Stack>
    </Box>
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
              <Value tone={term.ratePerSecond >= 0 ? "go" : "nogo"} size="xs">
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
        <Value size="xs">{formatRate(ledger.derivedNet)}</Value>
      </Cluster>
      {ledger.reportedNet !== undefined && (
        <Cluster justify="between" wrap>
          <Value tone="muted" size="xs">
            Reported
          </Value>
          <Value size="xs">{formatRate(ledger.reportedNet)}</Value>
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
