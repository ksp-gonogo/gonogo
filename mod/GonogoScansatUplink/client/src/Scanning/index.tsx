import type { ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  getBody,
  registerComponent,
  useDataValue,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  EmptyState,
  Grid,
  Panel,
  PanelTitle,
  ProgressBar,
  ScrollArea,
  Section,
  SectionTitle,
  Stack,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import {
  useScanAnomalies,
  useScanningVessels,
} from "../FogReveal/useScanLayers";
import type { SCANType } from "../schema";
import { SCAN_TYPE } from "../schema";
import { MinimapForActiveVessel } from "./Minimap";

// ---------------------------------------------------------------------------
// Augment slots.
//
// Scanning is a SCANsat-OWNED widget that nonetheless exposes slots OTHER
// Uplinks fill — a cross-Uplink example — even before the package
// itself moves to `@ksp-gonogo/scansat`. Two slots:
//
// `scanning.sections` — a body/section slot appended to the per-scan-type
// coverage list. The flagship future filler is another scanning mod
// contributing its OWN scan-type coverage row alongside SCANsat's altimetry/
// biome/anomaly rows. NOTE: SCANsat's own
// custom map LAYERS route to `map-view.overlay`, NOT here — this slot is for
// extra COVERAGE ROWS only.
//
// `scanning.badges` — a broad escape-hatch badge slot in the header, next to
// the title, for a small status/indicator an Uplink wants to surface.
//
// Both carry the widget's current body focus as slot props so an augment scopes
// its coverage rows / badge to the body the operator is actually looking at.
// No augment ships here yet — the slots render nothing until one
// registers.
// ---------------------------------------------------------------------------

/** Props both Scanning slots pass to their augments. */
export interface ScanningSlotContext {
  /**
   * The body the widget's body-scoped sections (coverage, anomalies) are
   * currently following — the config override when set, else the active
   * vessel's body. `undefined` before any active body is known. Lets an
   * augment scope its coverage row / badge to the same body.
   */
  bodyName: string | undefined;
}

// Declaration-merge the slot ids → props types into the sdk facade's
// `SlotRegistry`. Co-located here (not centralised in
// `mod/sitrep-sdk/src/api/slots.ts`, unlike packages/components-owned
// slots) because Scanning is this Uplink's OWN widget — this file is
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

function ScanningComponent({
  config,
}: Readonly<ComponentProps<ScanningConfig>>) {
  const activeBody = useDataValue<string>("data", "v.body");
  const bodyName = config?.bodyName ?? activeBody;
  const biome = useDataValue<string>("data", "v.biome");
  const scanAvailable = useDataValue<boolean>("data", "scansat.available");
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
              <Value size="sm" tone="default">
                Biome: {biome}
              </Value>
            </Card>
          ) : null}

          {body ? (
            <Section>
              <SectionTitle>Live view</SectionTitle>
              <MinimapForActiveVessel body={body} />
            </Section>
          ) : null}

          <Section>
            <SectionTitle>Coverage — {bodyName ?? "?"}</SectionTitle>
            {bodyName ? (
              <Stack gap="xs">
                {DISPLAY_SCAN_TYPES.map((type) => (
                  <CoverageRow key={type} bodyName={bodyName} scanType={type} />
                ))}
              </Stack>
            ) : (
              <EmptyState>No active body.</EmptyState>
            )}
            {/* Augment coverage rows — e.g. a resource-scanning Uplink
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
                        <Value size="sm" tone="default">
                          {v.vesselName || "(unnamed)"}
                        </Value>
                        <Value size="xs" tone="muted">
                          {v.body}
                        </Value>
                      </Cluster>
                      <Value size="xs" tone="muted">
                        sub-point {v.subLatitude.toFixed(2)},{" "}
                        {v.subLongitude.toFixed(2)} · alt{" "}
                        {Math.round(v.altitude / 1000).toLocaleString()} km
                      </Value>
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
                              <Value size="xs" tone="default">
                                {SCAN_TYPE_LABELS[s.type] ?? `type=${s.type}`}
                              </Value>
                              <Value size="xs" tone="muted">
                                FoV {s.fov.toFixed(1)}° · alt{" "}
                                {Math.round(s.minAlt / 1000)}–
                                {Math.round(s.maxAlt / 1000)} km
                              </Value>
                              <Badge
                                size="sm"
                                tone={
                                  s.bestRange
                                    ? "go"
                                    : s.inRange
                                      ? "info"
                                      : "neutral"
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
            <SectionTitle>Anomalies — {bodyName ?? "?"}</SectionTitle>
            {anomalies && anomalies.length > 0 ? (
              <Stack gap="xs">
                {anomalies.map((a) => (
                  <Grid key={`${a.name}-${a.latitude}`} cols="1fr auto">
                    <Value size="xs" tone={a.known ? "default" : "muted"}>
                      {a.detail
                        ? a.name
                        : a.known
                          ? "(unknown)"
                          : "(undetected)"}
                    </Value>
                    <Value size="xs" tone="muted">
                      {a.known
                        ? `${a.latitude.toFixed(2)}, ${a.longitude.toFixed(2)}`
                        : "—"}
                    </Value>
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
  const pct = useDataValue<number>(
    "data",
    `scansat.coverage.${bodyName}.${scanType}`,
  );
  const value = typeof pct === "number" ? pct : 0;
  return (
    <Grid cols="120px 1fr 60px" gap="md">
      <Value size="xs" tone="default">
        {SCAN_TYPE_LABELS[scanType]}
      </Value>
      <ProgressBar
        value={value}
        ariaLabel={`${SCAN_TYPE_LABELS[scanType]} coverage — ${bodyName}`}
      />
      <Value size="xs" tone="muted">
        {value.toFixed(1)}%
      </Value>
    </Grid>
  );
}

// ── Registration ────────────────────────────────────────────────────────────

registerComponent<ScanningConfig>({
  id: "scanning",
  name: "Scanning",
  description:
    "SCANsat status — per-scan-type coverage of the current body, the " +
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
    "v.body",
    "v.biome",
  ],
  defaultConfig: {},
  actions: [],
  // Augment slots. `sections` — extra coverage rows appended to the
  // per-scan-type coverage list (a resource-scanning Uplink's own coverage is
  // the canonical filler); `badges` — broad header escape-hatch. Both render
  // nothing until an Uplink registers. Custom map LAYERS go to map-view.overlay.
  augmentSlots: ["scanning.sections", "scanning.badges"],
  pushable: true,
});

export { ScanningComponent };
