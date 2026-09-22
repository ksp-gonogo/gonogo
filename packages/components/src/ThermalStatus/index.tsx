import type { ComponentProps } from "@ksp-gonogo/core";
import {
  clampSafe,
  defineTopicManifest,
  registerComponent,
} from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  EmptyState,
  NULL_DISPLAY,
  Panel,
  type ReadoutTone,
  Section,
  Stack,
  StatusPill,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { magnitudeOr } from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: ["vessel.thermal"],
  fields: [
    "vessel.thermal.hottestPart.name",
    "vessel.thermal.hottestPart.skinTemp",
    "vessel.thermal.hottestPart.skinMaxTemp",
    "vessel.thermal.maxInternalTempRatio",
    "vessel.thermal.hottestEngineTemp",
    "vessel.thermal.hottestEngineMaxTemp",
    "vessel.thermal.hottestEngineTempRatio",
    "vessel.thermal.anyEnginesOverheating",
    "vessel.thermal.heatShieldTemp",
    "vessel.thermal.heatShieldFlux",
  ],
});

// Empty config: room to add a "hide heat shield" toggle later.
type ThermalStatusConfig = Record<string, never>;

// Readings near absolute zero (~2 K) stand in for "no real value", typically
// when the corresponding part isn't fitted (e.g. early-career rocket with no
// thermometer or heat shield) or the science instrument hasn't been unlocked
// yet. Treat anything below this threshold as "no data" rather than rendering
// bogus CRITICAL bars. 50 K is well below any operational KSP part max (parts
// melt at thousands of K) and well below any meaningful in-game temperature.
//
// ONE threshold, because `vessel.thermal` is uniformly Kelvin. A Celsius twin
// beside it is what hides a unit error: `hottestPart.skinTemp` is Kelvin on the
// contract, and read as Celsius it renders ~273° high while its own guard
// (< −223 °C) can never fire on a kelvin sentinel. One unit on the channel
// removes the choice.
const THERMAL_SENTINEL_K = 50;

const isSentinelK = (k: number | undefined): boolean =>
  typeof k === "number" && Number.isFinite(k) && k < THERMAL_SENTINEL_K;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Thermal severity bands. Mirrors KSP's in-game thermal overlay:
 * - nominal   < 75% max
 * - warm      75–90%
 * - hot       90–97%
 * - critical  ≥ 97% (overheat imminent)
 */
type Band = "unknown" | "nominal" | "warm" | "hot" | "critical";

/**
 * `unknown` exists so an unarrived ratio never answers "nominal". A green
 * NOMINAL pill is a positive claim that nothing is overheating, and an absent
 * ratio is not evidence of that: collapsed onto `nominal` it reads identically
 * to a part measured at 40% of its maximum.
 */
function bandFromRatio(ratio: number | undefined): Band {
  if (ratio === undefined || !Number.isFinite(ratio)) return "unknown";
  if (ratio >= 0.97) return "critical";
  if (ratio >= 0.9) return "hot";
  if (ratio >= 0.75) return "warm";
  return "nominal";
}

// Heat escalation: green → yellow → orange → red, and warm and hot are
// DIFFERENT colours. Mapped to one orange, an operator at 94% sees the same
// colour as at 80% and cannot tell they are approaching critical. The
// yellow/orange split gives a visible step at the 90% gate.
const BAND_COLOR: Record<Band, string> = {
  unknown: "var(--color-text-faint)",
  nominal: "var(--color-accent-fg)",
  warm: "var(--color-tag-yellow-fg)",
  hot: "var(--color-status-warning-bg)",
  critical: "var(--color-status-nogo-bg)",
};

const BAND_LABEL: Record<Band, string> = {
  unknown: "unknown",
  nominal: "nominal",
  warm: "warm",
  hot: "hot",
  critical: "critical",
};

const BAND_TONE: Record<Band, ReadoutTone> = {
  // Neutral, not `go`: a green pill would be the very claim this band exists to
  // stop the widget making.
  unknown: "default",
  nominal: "go",
  // `warm` keeps `warning` tone for the StatusPill / inline alert layer
  // even though its bar colour is yellow, the alert taxonomy stays
  // binary (go/warning/alert) while the colour gradient is finer.
  warm: "warning",
  hot: "warning",
  critical: "alert",
};

/**
 * Used only to pick the worst of two bands for the summary pill. `unknown` sits
 * below `nominal` so any real measurement wins the pill: reporting a known warm
 * part matters more than reporting that a second reading is missing, and the
 * per-row band tags say which one is unknown.
 */
const BAND_RANK: Record<Band, number> = {
  unknown: -1,
  nominal: 0,
  warm: 1,
  hot: 2,
  critical: 3,
};

// Takes Kelvin (what the channel carries) and shows Celsius (what an operator
// reads). The conversion is a presentation choice made here, via the shared
// unit layer, rather than something the wire pre-applies: see the note on
// `Units.Kelvin` in the contract.
function Temp({ kelvin }: { kelvin: number | undefined }) {
  if (kelvin === undefined || !Number.isFinite(kelvin)) return NULL_DISPLAY;
  return (
    <Unit
      value={value("K", kelvin)}
      as="°C"
      // Drop to whole degrees once the number is wide, so the readout's width
      // stays stable as a part heats through the thousands.
      decimals={Math.abs(kelvin - 273.15) >= 1000 ? 0 : 1}
    />
  );
}

// Heat-shield flux arrives in kW and climbs to MW at reentry peak. Both rungs
// live in the shared `energyRate` ladder.
function Flux({ kw }: { kw: number | undefined }) {
  if (kw === undefined || !Number.isFinite(kw)) return NULL_DISPLAY;
  return <Unit value={value("kW", kw)} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

function ThermalStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<ThermalStatusConfig>>) {
  // ONE read of the record, then fields off it. This was ten separate
  // `useTelemetry("vessel.thermal")` calls, one per field, which is ten
  // subscriptions and ten reads of the same memoized record for one payload,
  // and would shortly have been ten branches on the same currency. A record is
  // read once and destructured; nothing about these ten fields can disagree
  // about how current it is, so nothing should ask ten times.
  /**
   * The BAND TAGS and the summary pill are judgements: each converts a
   * temperature ratio into "nominal" or "critical", and none of them can be
   * dated, because the operator reads a band as the situation now. So a stale
   * record lands them on the `unknown` band rather than on a green one.
   *
   * <p>The temperatures themselves are not judgements. The heat-shield
   * temperature and flux, the hottest part's name and its skin figures are
   * MEASUREMENTS, and a measurement can be dated: an operator who has lost the
   * link during re-entry is better served by the last heat-shield reading,
   * marked, than by a panel that has thrown it away. So the record is held and
   * only the ratios and the overheat flag are withheld, which is what
   * `datedJudgements` does.</p>
   */
  const thermalReading = topics.useTelemetry("vessel.thermal");
  const thermal =
    thermalReading.state === "observed" || thermalReading.state === "stale"
      ? thermalReading.value
      : undefined;
  const thermalNotCurrent = thermalReading.state === "stale";
  const rawHottestName = thermal?.hottestPart?.name;
  const rawHottestTempK = thermal?.hottestPart?.skinTemp;
  const rawHottestMaxK = thermal?.hottestPart?.skinMaxTemp;
  const rawHottestRatio = thermal?.maxInternalTempRatio;

  const rawEngineTempK = thermal?.hottestEngineTemp;
  const rawEngineMaxK = thermal?.hottestEngineMaxTemp;
  const rawEngineRatio = thermal?.hottestEngineTempRatio;
  const rawEngineOverheat = thermal?.anyEnginesOverheating;

  const rawShieldTempK = thermal?.heatShieldTemp;
  const rawShieldFluxKw = thermal?.heatShieldFlux;

  // Connectivity indicator (mirroring the WarpControl pilot).
  // `therm.hottestPartTemp` is the widget's one representative MAPPED key
  // (-> `vessel.thermal.hottestPart.skinTemp`). The heat-shield rows are
  // mapped too (`vessel.thermal.heatShieldTemp`/`heatShieldFlux`), but
  // the engine rows still read GAPPED keys (map-topic.ts's
  // LEGACY_KEY_GAPS "thermal detail beyond headline ratios") and stay on
  // legacy regardless, so a single representative mapped key drives this badge
  // rather than conflating "stream carried" with "legacy connected".

  // Sentinel guard: drop the whole group when its max (or temp) is at the
  // absolute-zero floor. The ratio is meaningless in that case and rendering
  // it lights up CRITICAL on a rocket with no thermometer / engine fitted.
  const hottestSentinel =
    isSentinelK(rawHottestMaxK?.magnitude) ||
    isSentinelK(rawHottestTempK?.magnitude);
  const engineSentinel =
    isSentinelK(rawEngineMaxK?.magnitude) ||
    isSentinelK(rawEngineTempK?.magnitude);
  const shieldSentinel = isSentinelK(rawShieldTempK?.magnitude);

  const hottestName = hottestSentinel ? undefined : rawHottestName;
  const hottestTempK = hottestSentinel ? undefined : rawHottestTempK;
  const hottestMaxK = hottestSentinel ? undefined : rawHottestMaxK;
  const hottestRatio = hottestSentinel ? undefined : rawHottestRatio;

  const engineTempK = engineSentinel ? undefined : rawEngineTempK;
  const engineMaxK = engineSentinel ? undefined : rawEngineMaxK;
  const engineRatio = engineSentinel ? undefined : rawEngineRatio;
  // anyEnginesOverheating is independent telemetry, but it's nonsense if
  // no engine is fitted at all, so honour the same guard.
  const engineOverheat = engineSentinel ? undefined : rawEngineOverheat;

  const shieldTempK = shieldSentinel ? undefined : rawShieldTempK;
  const shieldFluxKw = shieldSentinel ? undefined : rawShieldFluxKw;

  /* The judgements, and only the judgements, are withheld once the record stops
     arriving. A band is read as the situation NOW, and a craft that has since
     flown deeper into re-entry would keep showing "nominal" for as long as the
     link stayed down, so feeding the ratios through drops both bands to
     `unknown` exactly as a never-read ratio does. The temperatures they were
     derived from are still drawn, dated, because a dated measurement is the
     operator's best information and a blank one is nothing at all. */
  const hottestBand = thermalNotCurrent
    ? bandFromRatio(undefined)
    : bandFromRatio(hottestRatio?.magnitude);
  const engineBand = thermalNotCurrent
    ? bandFromRatio(undefined)
    : engineOverheat
      ? "critical"
      : bandFromRatio(engineRatio?.magnitude);

  // The pill summarises the worst observed band, it's the at-a-glance
  // affordance the tiny mode lives by.
  const worstBand: Band =
    BAND_RANK[engineBand] > BAND_RANK[hottestBand] ? engineBand : hottestBand;
  const anyCritical = worstBand === "critical";

  /**
   * "No thermal data" replaces the whole body, so it has to mean that nothing at
   * all is known, not that the four named fields are missing.
   *
   * Checking only the names and temperatures makes a payload carrying a
   * `maxInternalTempRatio` of 0.99 and nothing else render "No thermal data": a
   * part at 99% of its maximum, present on the wire, suppressed by the absence
   * of readings around it. The ratios and the overheat flag are readings too.
   */
  const noData =
    hottestName === undefined &&
    hottestTempK === undefined &&
    hottestRatio === undefined &&
    engineTempK === undefined &&
    engineRatio === undefined &&
    engineOverheat === undefined &&
    shieldTempK === undefined &&
    shieldFluxKw === undefined;

  // Selective rendering: pill is always shown; rows drop from the bottom
  // (heat shield first, then engine, then hottest-part) as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 7;
  const showHottestRow = rows >= 5;
  const showEngineRow = rows >= 6;
  const hasShieldData = shieldTempK !== undefined || shieldFluxKw !== undefined;
  const showShieldRow = rows >= 7 && hasShieldData;
  // Inline alert fires at hot (90-97%) and critical (≥97%), the
  // hot band is the "still time to act" warning; without an alert at
  // 94% the operator only got the colour change in the bar and a
  // small "hot" tag, no headline cue. Critical keeps the louder
  // wording and aria-live.
  const anyHotOrAbove = worstBand === "hot" || worstBand === "critical";
  const showInlineAlert = anyHotOrAbove && cols >= 6;

  /*
   * Only "none reported" empties the panel now. A record that has merely stopped
   * arriving still has every temperature in it, so replacing the body with a
   * sentence threw away the heat-shield reading an operator who has just lost
   * the link most wants. That case gets a dated caption over a live body
   * instead, and the bands above have already dropped to `unknown`.
   */
  const absence = noData ? "No thermal data" : null;

  return (
    <Panel
      panelTitle="THERMAL"
      sections={[
        absence !== null && (
          <Section key="absence" full>
            <EmptyState>{absence}</EmptyState>
          </Section>
        ),
        absence === null && thermalNotCurrent && (
          <Section key="dated" full>
            {/* Names which half is dated: the figures below are real readings
                held from the last delivery, while the bands and the pill have
                gone to unknown because a judgement cannot be dated. */}
            <Text tone="warn" size="xs" role="status" aria-live="polite">
              Thermal readings no longer current: the temperatures are the last
              reported, and the bands are unknown until they resume.
            </Text>
          </Section>
        ),
        absence === null && (
          <Section key="state" full>
            <div
              style={PILL_ROW_STYLE}
              role={anyCritical ? "alert" : "status"}
              aria-live={anyCritical ? "assertive" : "polite"}
            >
              <StatusPill
                $tone={BAND_TONE[worstBand]}
                style={COMPACT_PILL_STYLE}
              >
                {BAND_LABEL[worstBand]}
              </StatusPill>
              {showInlineAlert && (
                <span style={CRITICAL_NOTE_STYLE}>
                  {engineOverheat
                    ? "Engine overheating (>90% max)"
                    : anyCritical
                      ? "Part at max temperature"
                      : "Part approaching max temperature"}
                </span>
              )}
            </div>
          </Section>
        ),
        /* No `ScrollArea` around the rows. Panel's body IS the scroller and
           owns the glow, so a second one here drew its glow inside the outer
           body's inset, which is the case the kit's own doc comment names. */
        absence === null &&
          (showHottestRow || showEngineRow || showShieldRow) && (
            <Section key="rows" full>
              <Stack style={READOUT_GROUPS_STYLE}>
                {showHottestRow && (
                  <Section>
                    <div style={ROW_HEADER_STYLE}>
                      <div style={ROW_LABEL_STYLE}>Hottest part</div>
                      <span style={bandTagStyle(hottestBand)}>
                        {BAND_LABEL[hottestBand]}
                      </span>
                    </div>
                    <div style={ROW_BODY_STYLE}>
                      <div style={PART_NAME_STYLE}>
                        {hottestName ?? NULL_DISPLAY}
                      </div>
                      <div style={TEMP_METER_STYLE}>
                        <div
                          style={{
                            ...TEMP_BAR_STYLE,
                            width: `${clampPct(magnitudeOr(hottestRatio, 0) * 100)}%`,
                            background: BAND_COLOR[hottestBand],
                          }}
                        />
                      </div>
                      <div style={TEMP_READOUT_STYLE}>
                        <span style={TEMP_VALUE_STYLE}>
                          {<Temp kelvin={hottestTempK?.magnitude} />}
                        </span>
                        {hottestMaxK !== undefined && (
                          <span style={MAX_TAG_STYLE}>
                            / {<Temp kelvin={hottestMaxK.magnitude} />} max
                          </span>
                        )}
                      </div>
                    </div>
                  </Section>
                )}

                {showEngineRow && (
                  <Section>
                    <div style={ROW_HEADER_STYLE}>
                      <div style={ROW_LABEL_STYLE}>Hottest engine</div>
                      <span style={bandTagStyle(engineBand)}>
                        {BAND_LABEL[engineBand]}
                      </span>
                    </div>
                    <div style={ROW_BODY_STYLE}>
                      <div style={TEMP_METER_STYLE}>
                        <div
                          style={{
                            ...TEMP_BAR_STYLE,
                            width: `${clampPct(magnitudeOr(engineRatio, 0) * 100)}%`,
                            background: BAND_COLOR[engineBand],
                          }}
                        />
                      </div>
                      <div style={TEMP_READOUT_STYLE}>
                        <span style={TEMP_VALUE_STYLE}>
                          {<Temp kelvin={engineTempK?.magnitude} />}
                        </span>
                        {/* `!= null`: `maxK` is a `double?` and the wire keeps
                          the key, so a part with no rated maximum arrives as an
                          explicit null and the strict form reached
                          `.magnitude` on it. */}
                        {engineMaxK != null && (
                          <span style={MAX_TAG_STYLE}>
                            / {<Temp kelvin={engineMaxK.magnitude} />} max
                          </span>
                        )}
                      </div>
                    </div>
                  </Section>
                )}

                {showShieldRow && (
                  <Section>
                    <div style={ROW_LABEL_STYLE}>Heat shield</div>
                    <div style={ROW_BODY_STYLE}>
                      <div style={TEMP_READOUT_STYLE}>
                        <span style={TEMP_VALUE_STYLE}>
                          {<Temp kelvin={shieldTempK?.magnitude} />}
                        </span>
                        <span style={MAX_TAG_STYLE}>
                          · flux {<Flux kw={shieldFluxKw?.magnitude} />}
                        </span>
                      </div>
                    </div>
                  </Section>
                )}
              </Stack>
            </Section>
          ),
      ]}
    />
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const clampPct = (pct: number): number => clampSafe(pct, 0, 100);

// ── Styles ────────────────────────────────────────────────────────────────────

const PILL_ROW_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--gap-related)",
} as const;

/*
 * The shared StatusPill sizes itself to its label at a fixed padding, fine
 * everywhere it is used except this widget's narrowest pill-only mode (minSize
 * is 3 columns wide), where "CRITICAL" does not fit and overflows past the
 * panel's right edge under Panel's overflow:hidden. `minWidth: 0` lets the flex
 * item shrink below its intrinsic content width, which the flexbox default of
 * `auto` blocks; the tighter padding and letter-spacing buy back room so common
 * labels still render whole, and the ellipsis is a legible fallback.
 *
 * The padding pair is off the spacing ladder: the only meaning those numbers
 * carry is their delta from the base StatusPill, whose own padding is
 * var(--space-6) var(--space-12). The nearest rungs either erase the tightening
 * or erase the delta outright, so the pair stays literal until it is retuned
 * against the base in one edit across both packages.
 */
const COMPACT_PILL_STYLE = {
  minWidth: 0,
  maxWidth: "100%",
  padding: "5px 10px",
  letterSpacing: "0.06em",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
} as const;

const CRITICAL_NOTE_STYLE = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-status-nogo-fg)",
  letterSpacing: "0.04em",
} as const;

/*
 * The space between consecutive readout groups, owned by the parent so a group
 * that does not render leaves no gap behind it.
 *
 * 10px rather than the 8px it reads as: each group is a `Section`, and the
 * `Section` around them contributes its own 2px on top. The two numbers were
 * never added up while the spacing lived on the groups themselves.
 */
const READOUT_GROUPS_STYLE = { gap: "var(--space-10)" } as const;

/*
 * Label and band badge share the row's top line so the band reads as a
 * top-right badge and the value readout below stays short. At the narrowest
 * sizes the readout no longer wraps the band tag onto a second line that then
 * gets clipped.
 */
const ROW_HEADER_STYLE = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "var(--gap-related)",
} as const;

const ROW_LABEL_STYLE = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--color-text-dim)",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const ROW_BODY_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
} as const;

const PART_NAME_STYLE = {
  fontSize: "var(--font-size-value)",
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

const TEMP_METER_STYLE = {
  height: "8px",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  overflow: "hidden",
} as const;

/*
 * `linear` is load-bearing, not stylistic: the bar is driven by telemetry
 * samples and an eased fill reads as the value stalling between them.
 */
const TEMP_BAR_STYLE = {
  height: "100%",
  transition:
    "width var(--duration-base) var(--ease-linear), background var(--duration-base) var(--ease-linear)",
} as const;

const TEMP_READOUT_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: "var(--space-2) var(--space-6)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-primary)",
} as const;

/** Temp value stays intact rather than breaking "287.5°C" mid-token. */
const TEMP_VALUE_STYLE = { whiteSpace: "nowrap" } as const;

const MAX_TAG_STYLE = {
  color: "var(--color-text-faint)",
  fontSize: "var(--font-size-compact)",
  whiteSpace: "nowrap",
} as const;

/** The band badge takes its colour from the band it reports. */
function bandTagStyle(band: Band) {
  return {
    flexShrink: 0,
    fontSize: "var(--font-size-caption)",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    color: BAND_COLOR[band],
  } as const;
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ThermalStatusConfig>({
  id: "thermal-status",
  name: "Thermal",
  description:
    "Aggregate thermal readouts: hottest part, hottest engine, heat shield temperature and flux. Alerts when any part or engine approaches its limit.",
  tags: ["telemetry", "thermal"],
  defaultSize: { w: 8, h: 7 },
  minSize: { w: 3, h: 4 },
  component: ThermalStatusComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { ThermalStatusComponent };
