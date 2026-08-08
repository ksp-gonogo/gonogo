import type {
  ComponentProps,
  KerbalismGreenhouseEntry,
  KerbalismHabitat,
  KerbalismProcessEntry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  registerComponent,
  useProcessor,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Box,
  Cluster,
  Disclosure,
  Divider,
  EmptyState,
  Meter,
  MeterStack,
  Panel,
  Section,
  Stack,
  severityFromBadgeTone,
  speakQuantity,
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

/** "12 / 40 · 3m 20s" style meter caption; "not fitted" for a tankless resource. */
function rowValueLabel(row: ResourceRow): string {
  if (row.capacity <= 0) return "not fitted";
  return `${fmtAmt(row.amount)} / ${fmtAmt(row.capacity)} · ${formatTimeToEmpty(row.secondsToEmpty)}`;
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
}

function toGreenhouseRow(g: KerbalismGreenhouseEntry): GreenhouseRow {
  return {
    cropResource: g.cropResource || "Food",
    natural: mag(g.natural),
    artificial: mag(g.artificial),
    active: g.active ?? false,
    issue: g.issue ?? "",
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

  return <ShipSystemsBody ship={ship} />;
}

function overallStatus(ship: ShipSystems): { label: string; tone: Tone } {
  if (ship.summary.causes.length > 0)
    return { label: "Critical", tone: "nogo" };
  const tones = ship.summary.supplies.map(toneForRow);
  if (tones.includes("nogo")) return { label: "Critical", tone: "nogo" };
  if (tones.includes("warn")) return { label: "Degraded", tone: "warn" };
  return { label: "Nominal", tone: "go" };
}

function ShipSystemsBody({ ship }: { ship: ShipSystems }) {
  const { summary } = ship;
  const status = overallStatus(ship);
  const habitat: KerbalismHabitat | undefined = ship.lifeSupport?.habitat;
  const processes = (ship.lifeSupport?.processes ?? []).map(toProcessRow);
  const greenhouses = (ship.lifeSupport?.greenhouses ?? []).map(
    toGreenhouseRow,
  );

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
          <Box
            surface="sunken"
            pad="sm"
            radius="sm"
            role="status"
            aria-live="polite"
          >
            <Stack gap="xs">
              <Value tone="nogo" weight="semibold" size="sm">
                Root cause
              </Value>
              {summary.causes.map((cause) => (
                <Value key={cause.name} tone="nogo" size="xs">
                  {cause.displayName}
                  {cause.explains.length > 0
                    ? ` → blocks ${cause.explains.join(", ")}`
                    : ""}
                </Value>
              ))}
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
        <AugmentSlot name="life-support.sections" props={{ greenhouses }} />
      </Stack>

      {ecRow && (
        <FooterRow>
          <Meter
            label="Power"
            value={ecRow.fraction ?? 0}
            tone={toneForRow(ecRow)}
            valueLabel={rowValueLabel(ecRow)}
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
 * One resource row: a `Meter` plus an accessible `Disclosure` revealing its
 * per-source rate ledger (`buildLedger`, a click-time pure call over the
 * already-carried profile/lifeSupport/crew, never re-derived by the
 * Processor). `blockedBy`/`explains` render as a footnote beneath the meter
 * so the diagnosis reads without opening the ledger.
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
    <Box pad="xs" surface="raised" radius="sm">
      <Cluster justify="between" align="start" gap="sm">
        <Meter
          label={row.displayName}
          value={row.fraction ?? 0}
          tone={toneForRow(row)}
          valueLabel={rowValueLabel(row)}
          size="sm"
        />
        <Disclosure
          label="Ledger"
          ariaLabel={`Show rate ledger for ${row.displayName}`}
        >
          <LedgerBody ledger={ledger} />
        </Disclosure>
      </Cluster>
      {row.role === "root" && row.explains.length > 0 && (
        <Value tone="nogo" size="xs">
          Explains: {row.explains.join(", ")}
        </Value>
      )}
      {row.role === "downstream" && row.blockedBy.length > 0 && (
        <Value tone="warn" size="xs">
          Blocked by: {row.blockedBy.join(", ")}
        </Value>
      )}
    </Box>
  );
}

function LedgerBody({ ledger }: { ledger: Ledger }) {
  const hasResidual =
    ledger.residual !== undefined && Math.abs(ledger.residual) > 1e-6;
  return (
    <Stack gap="xs" style={{ minWidth: "12rem" }}>
      {ledger.terms.length === 0 ? (
        <Value tone="muted" size="xs">
          No modelled sources
        </Value>
      ) : (
        ledger.terms.map((term) => (
          <Cluster
            key={`${term.kind}-${term.name}-${term.flightId ?? ""}`}
            justify="between"
          >
            <Value tone="default" size="xs">
              {term.name}
            </Value>
            <Value tone={term.ratePerSecond >= 0 ? "go" : "nogo"} size="xs">
              {formatRate(term.ratePerSecond)}
            </Value>
          </Cluster>
        ))
      )}
      <Divider space="xs" />
      <Cluster justify="between">
        <Value tone="muted" size="xs">
          Net (derived)
        </Value>
        <Value size="xs">{formatRate(ledger.derivedNet)}</Value>
      </Cluster>
      {ledger.reportedNet !== undefined && (
        <Cluster justify="between">
          <Value tone="muted" size="xs">
            Reported
          </Value>
          <Value size="xs">{formatRate(ledger.reportedNet)}</Value>
        </Cluster>
      )}
      {hasResidual && ledger.residual !== undefined && (
        <Value tone="warn" size="xs">
          Residual {formatRate(ledger.residual)} (modifiers not modelled)
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
