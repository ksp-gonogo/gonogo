import type { ComponentProps, Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  getBody,
  registerComponent,
  useTelemetry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  EmptyState,
  Grid,
  NULL_DISPLAY,
  Panel,
  PanelTitle,
  ProgressBar,
  ScrollArea,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  useScanAnomalies,
  useScanningVessels,
} from "../FogReveal/useScanLayers";
import type { SCANType } from "../schema";
import { SCAN_TYPE } from "../schema";
import { SCANSAT } from "../uplink";
import { MinimapForActiveVessel } from "./Minimap";

// ---------------------------------------------------------------------------
// Augment slots.
//
// Scanning is a SCANsat-OWNED widget that nonetheless exposes slots OTHER
// Uplinks fill (a cross-Uplink example) even before the package
// itself moves to `@ksp-gonogo/gonogo-scansat-uplink`. Two slots:
//
// `scanning.sections`: a body/section slot appended to the per-scan-type
// coverage list. The flagship future filler is another scanning mod
// contributing its OWN scan-type coverage row alongside SCANsat's altimetry/
// biome/anomaly rows. NOTE: SCANsat's own
// custom map LAYERS route to `map-view.overlay`, NOT here, this slot is for
// extra COVERAGE ROWS only.
//
// `scanning.badges`: a broad escape-hatch badge slot in the header, next to
// the title, for a small status/indicator an Uplink wants to surface.
//
// Both carry the widget's current body focus as slot props so an augment scopes
// its coverage rows / badge to the body the operator is actually looking at.
// No augment ships here yet: the slots render nothing until one
// registers.
// ---------------------------------------------------------------------------

/** Props both Scanning slots pass to their augments. */
export interface ScanningSlotContext {
  /**
   * The body the widget's body-scoped sections (coverage, anomalies) are
   * currently following: the config override when set, else the active
   * vessel's body. `undefined` before any active body is known. Lets an
   * augment scope its coverage row / badge to the same body.
   */
  bodyName: string | undefined;
}

// Declaration-merge the slot ids → props types into the sdk facade's
// `SlotRegistry`. Co-located here (not centralised in
// `mod/sitrep-sdk/src/api/slots.ts`, unlike packages/components-owned
// slots) because Scanning is this Uplink's OWN widget, this file is
// always part of scansat's own compiled program, so there is no
// cross-package reachability problem for the slot's OWNER (only for a
// FOREIGN filler in a different package, which isn't the case here today;
// see slots.ts's header comment for the full reasoning). This is what
// types `registerAugment({ augments: "scanning.sections", ... })` and
// `<AugmentSlot name="scanning.sections" props={...} />` against
// `ScanningSlotContext` rather than the loose fallback.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface SlotRegistry {
    "scanning.sections": ScanningSlotContext;
    "scanning.badges": ScanningSlotContext;
  }
}

export interface ScanningConfig {
  /**
   * When set, restrict the body-scoped sections (coverage, anomalies)
   * to this body name. When unset, follows the active vessel's body.
   */
  bodyName?: string;
}

const SCAN_TYPE_LABELS: Record<number, string> = {
  [SCAN_TYPE.AltimetryLoRes]: "Altimetry (Lo)",
  [SCAN_TYPE.AltimetryHiRes]: "Altimetry (Hi)",
  [SCAN_TYPE.Biome]: "Biome",
  [SCAN_TYPE.Anomaly]: "Anomaly",
  [SCAN_TYPE.AnomalyDetail]: "Anomaly detail",
  [SCAN_TYPE.ResourceLoRes]: "Resource (Lo)",
  [SCAN_TYPE.ResourceHiRes]: "Resource (Hi)",
};

const DISPLAY_SCAN_TYPES: SCANType[] = [
  SCAN_TYPE.AltimetryHiRes,
  SCAN_TYPE.AltimetryLoRes,
  SCAN_TYPE.Biome,
  SCAN_TYPE.Anomaly,
  SCAN_TYPE.ResourceHiRes,
];

/**
 * Resolve the active vessel's current body NAME. `vessel.identity` only
 * carries the stable `system.bodies` INDEX (`parentBodyIndex`), the same
 * index/name split `AnomalyOverlay/index.tsx`'s `useBodyIndexByName` and
 * `packages/components/src/MapView/vanillaPoiProvider.ts`'s
 * `useBodyNameByIndex` resolve elsewhere; this is the single-body variant of
 * that lookup (the widget only ever needs the active vessel's own body, not
 * a full index->name table).
 */
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

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

function useActiveVesselBodyName(): string | undefined {
  // Both facts: a vessel's parent body and the body catalogue change by event.
  const identity = stillTrue(useTelemetry("vessel.identity"), undefined);
  const systemBodies = stillTrue(useTelemetry("system.bodies"), undefined);
  return useMemo(() => {
    const index = identity?.parentBodyIndex;
    if (index == null) return undefined;
    return systemBodies?.bodies.find((b) => b.index === index)?.name;
  }, [identity, systemBodies]);
}

function ScanningComponent({
  config,
}: Readonly<ComponentProps<ScanningConfig>>) {
  const activeBody = useActiveVesselBodyName();
  const bodyName = config?.bodyName ?? activeBody;
  // The biome under the craft is a judgement: it changes as the craft moves, and a
  // held one would label a scan with the wrong terrain.
  const surface = judgeable(useTelemetry("vessel.surface"));
  const biome = surface?.biome;
  // A presence gate, so a fact: a domain that reported and went quiet is still
  // installed.
  const scanAvailable = stillTrue(useTelemetry("scansat.available"), undefined);
  const scanningVessels = useScanningVessels();
  const anomalies = useScanAnomalies(bodyName);

  // Stable per-body slot-props object so an unchanged body focus doesn't churn
  // mounted augments. Declared before any early return so the hook
  // order stays stable across the SCANsat-absent / present paths.
  const slotProps = useMemo<ScanningSlotContext>(
    () => ({ bodyName }),
    [bodyName],
  );

  if (scanAvailable === false) {
    return (
      <Panel>
        <PanelTitle>Scanning</PanelTitle>
        <EmptyState>
          SCANsat is not installed. Install it for fog-of-war, biome imaging,
          anomaly tracking, and the per-vessel scanner readouts this widget
          surfaces.
        </EmptyState>
      </Panel>
    );
  }

  const body = bodyName ? getBody(bodyName) : undefined;

  return (
    <Panel>
      <Cluster>
        <PanelTitle>Scanning</PanelTitle>
        <AugmentSlot name="scanning.badges" props={slotProps} />
      </Cluster>

      <ScrollArea>
        <Stack gap="lg">
          {biome ? (
            <Card>
              <Text size="sm" tone="default">
                Biome: {biome}
              </Text>
            </Card>
          ) : null}

          {body ? (
            <Section>
              <SectionTitle>Live view</SectionTitle>
              <MinimapForActiveVessel body={body} />
            </Section>
          ) : null}

          <Section>
            <SectionTitle>Coverage: {bodyName ?? "?"}</SectionTitle>
            {bodyName ? (
              <Stack gap="xs">
                {DISPLAY_SCAN_TYPES.map((type) => (
                  <CoverageRow key={type} bodyName={bodyName} scanType={type} />
                ))}
              </Stack>
            ) : (
              <EmptyState>No active body.</EmptyState>
            )}
            {/* Augment coverage rows: e.g. a resource-scanning Uplink
                contributing its own scan-type coverage alongside SCANsat's.
                Appended to the coverage list; empty until an Uplink registers. */}
            <AugmentSlot name="scanning.sections" props={slotProps} />
          </Section>

          <Section>
            <SectionTitle>Scanning vessels</SectionTitle>
            {scanningVessels && scanningVessels.length > 0 ? (
              <Stack gap="md">
                {scanningVessels.map((v) => (
                  <Card key={v.vesselId}>
                    <Stack gap="xs">
                      <Cluster>
                        <Text size="sm" tone="default">
                          {v.vesselName || "(unnamed)"}
                        </Text>
                        <Text size="xs" tone="muted">
                          {v.body}
                        </Text>
                      </Cluster>
                      <Text size="xs" tone="muted">
                        sub-point {v.subLatitude.toFixed(2)},{" "}
                        {v.subLongitude.toFixed(2)} · alt{" "}
                        {/* Pinned to km rather than left to the ladder: this
                            widget has three altitude readouts and a range
                            below whose two ends share one symbol, and a rung
                            that moves under any of them reads as a different
                            measurement. */}
                        <Unit
                          value={value("m", v.altitude)}
                          format="km"
                          decimals={0}
                        />
                      </Text>
                      <Stack gap="xs">
                        {v.sensors.length === 0 ? (
                          <EmptyState>No scanners.</EmptyState>
                        ) : (
                          v.sensors.map((s, i) => (
                            <Grid
                              // biome-ignore lint/suspicious/noArrayIndexKey: sensors don't have a stable id; index is the natural order
                              key={i}
                              cols="140px 1fr auto"
                              gap="md"
                            >
                              <Text size="xs" tone="default">
                                {SCAN_TYPE_LABELS[s.type] ?? `type=${s.type}`}
                              </Text>
                              <Text size="xs" tone="muted">
                                FoV{" "}
                                <Unit value={value("°", s.fov)} decimals={1} />{" "}
                                · alt{" "}
                                <Unit
                                  value={value("m", s.minAlt)}
                                  format="km"
                                  decimals={0}
                                />
                                –
                                <Unit
                                  value={value("m", s.maxAlt)}
                                  format="km"
                                  decimals={0}
                                />
                              </Text>
                              <Badge
                                size="sm"
                                severity={
                                  s.bestRange
                                    ? "nominal"
                                    : s.inRange
                                      ? "info"
                                      : undefined
                                }
                              >
                                {s.bestRange
                                  ? "best"
                                  : s.inRange
                                    ? "scanning"
                                    : "out of range"}
                              </Badge>
                            </Grid>
                          ))
                        )}
                      </Stack>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            ) : (
              <EmptyState>No vessels tracked by SCANsat yet.</EmptyState>
            )}
          </Section>

          <Section>
            <SectionTitle>Anomalies: {bodyName ?? "?"}</SectionTitle>
            {anomalies && anomalies.length > 0 ? (
              <Stack gap="xs">
                {anomalies.map((a) => (
                  <Grid key={`${a.name}-${a.latitude}`} cols="1fr auto">
                    <Text size="xs" tone={a.known ? "default" : "muted"}>
                      {a.detail
                        ? a.name
                        : a.known
                          ? "(unknown)"
                          : "(undetected)"}
                    </Text>
                    <Text size="xs" tone="muted">
                      {a.known
                        ? `${a.latitude.toFixed(2)}, ${a.longitude.toFixed(2)}`
                        : NULL_DISPLAY}
                    </Text>
                  </Grid>
                ))}
              </Stack>
            ) : (
              <EmptyState>None known.</EmptyState>
            )}
          </Section>
        </Stack>
      </ScrollArea>
    </Panel>
  );
}

function CoverageRow({
  bodyName,
  scanType,
}: Readonly<{ bodyName: string; scanType: SCANType }>) {
  const pct = useTelemetry<number>(
    "data",
    `scansat.coverage.${bodyName}.${scanType}`,
  );
  const coverage = typeof pct === "number" ? pct : 0;
  return (
    <Grid cols="120px 1fr 60px" gap="md">
      <Text size="xs" tone="default">
        {SCAN_TYPE_LABELS[scanType]}
      </Text>
      <ProgressBar
        value={coverage}
        ariaLabel={`${SCAN_TYPE_LABELS[scanType]} coverage: ${bodyName}`}
      />
      <Text size="xs" tone="muted">
        <Unit value={value("%", coverage)} decimals={1} />
      </Text>
    </Grid>
  );
}

// ── Registration ────────────────────────────────────────────────────────────

registerComponent<ScanningConfig>({
  id: "scanning",
  name: "Scanning",
  description:
    "SCANsat status: per-scan-type coverage of the current body, the " +
    "list of vessels SCANsat is tracking with their on-board scanners " +
    "and live in-range state, and the body's known anomalies with " +
    "discovery state.",
  tags: ["scan", "fleet"],
  defaultSize: { w: 6, h: 10 },
  minSize: { w: 3, h: 4 },
  component: ScanningComponent,
  openConfigOnAdd: false,
  dataRequirements: [
    "scansat.available",
    "scansat.scanningVessels",
    "vessel.identity",
    "system.bodies",
    "vessel.surface",
  ],
  defaultConfig: {},
  actions: [],
  // Augment slots. `sections`: extra coverage rows appended to the
  // per-scan-type coverage list (a resource-scanning Uplink's own coverage is
  // the canonical filler); `badges`: broad header escape-hatch. Both render
  // nothing until an Uplink registers. Custom map LAYERS go to map-view.overlay.
  augmentSlots: ["scanning.sections", "scanning.badges"],
  pushable: true,
  owner: SCANSAT,
});

export { ScanningComponent };
