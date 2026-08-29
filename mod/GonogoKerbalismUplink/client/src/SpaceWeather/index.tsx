import type {
  ComponentProps,
  Reading,
  VesselState,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  useStream,
  useTelemetry,
  useViewUt,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Box,
  Card,
  Cluster,
  Countdown,
  EmptyState,
  Meter,
  MissionDate,
  magnitudeOf,
  magnitudeOr,
  Panel,
  ProgressBar,
  ReadoutCaption,
  type ReadoutTone,
  Section,
  SectionTitle,
  type Severity,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import styled, { css, keyframes } from "styled-components";
// This Uplink's own wire shapes for the sun-vantage half of the payload, named
// from the generated contract slice the same way Ship Systems names its own.
import type {
  KerbalismStarInfo,
  KerbalismStormEntry,
  KerbalismStormTargetKind,
} from "../__generated__/contract";
import { KERBALISM } from "../uplink";

type SpaceWeatherConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// Data read
//
// Reads this Uplink's `kerbalism.spaceweather` Topic (canonical one-arg
// useTelemetry: streams whenever a provider is mounted). Vessel altitude
// (belt-ring placement) comes from the `vessel.flight` channel. The
// presentation below is a pure function of `SpaceWeatherData`, so the offline
// snapshot harness feeds the same shape (see this folder's snapshots.test.tsx).
// This hook is the only data boundary.
// ---------------------------------------------------------------------------

type StormState = "none" | "incoming" | "inprogress";

interface SpaceWeatherData {
  radiationRadPerHour: number;
  stormState: StormState;
  innerBelt: boolean;
  outerBelt: boolean;
  magnetosphere: boolean;
  blackout: boolean;
  shieldingValue: number;
  shieldingCapacity: number;
  /** null when the vessel's altitude is not current: the rings then draw no "you are here" dot */
  altitudeKm: number | null;
  seed: number;
  /** Every star this vessel sees, its own vantage on each. 1..N, uniform for a binary pack. */
  stars: KerbalismStarInfo[];
  /** Every CME slot the mod reports, INCLUDING state 0 (none): callers filter. */
  storms: KerbalismStormEntry[];
  /** `PreferencesRadiation.Instance.StormEjectionSpeed`, m/s. Null until first capture. */
  stormEjectionSpeedMps: number | null;
}

/** Why the board is not being drawn, in the operator's terms. */
type WeatherAbsence = "not-current" | "confirmed-none" | "awaiting";

const ABSENCE_TEXT: Record<WeatherAbsence, string> = {
  // Three different sentences on purpose. "The link dropped" and "this is the
  // first paint" are not the same accusation, and a vessel whose subject
  // confirms it has no space-weather record (no Kerbalism, or nothing loaded)
  // is not waiting for anything.
  "not-current": "Space weather no longer current",
  "confirmed-none": "No space-weather data reported",
  awaiting: "Awaiting space weather",
};

type SpaceWeatherRead =
  | { readable: true; data: SpaceWeatherData }
  | { readable: false; absence: WeatherAbsence };

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

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * Every field on this record is a judgement, so the record is judged as one.
 *
 * The dose rate picks a tone band, the storm bools pick a headline, the three
 * environment bools light the belt rings and drive the header verdict, and the
 * shielding pair becomes a toned meter. Not one of them is a fact that holds
 * until an event changes it: they are all functions of where the craft currently
 * sits in a magnetic field and a storm timeline, and every one of them can drift
 * while nobody is looking.
 *
 * `shieldingCapacity` is the one plausible fact (fitted hardware), and it still
 * goes through `judgeable`, because it is only ever drawn as the denominator of a
 * ratio whose numerator is withheld. "0.0 / 3.3" with a red bar is a verdict
 * about a habitat, assembled from one number we have and one we do not.
 *
 * Withholding the record therefore withholds the whole board, which is the
 * honest outcome: the alternative is the pre-migration behaviour, where an
 * absent record coerced to a confident "Sheltered, no storm activity, 0.000
 * rad/h" board built from nothing at all.
 */
function useSpaceWeather(): SpaceWeatherRead {
  const weatherReading = useTelemetry("kerbalism.spaceweather");
  // Positional, so also a judgement: this only places the "you are here" dot on
  // the belt diagram, and a dot drawn from an altitude taken some seconds ago
  // states the craft is in a band it may have left.
  const flight = judgeable(useTelemetry("vessel.flight"));
  const t = judgeable(weatherReading);

  if (t === undefined) {
    return {
      readable: false,
      absence: notCurrent(weatherReading)
        ? "not-current"
        : weatherReading.state === "absent"
          ? "confirmed-none"
          : "awaiting",
    };
  }

  const stormState: StormState = t.stormInProgress
    ? "inprogress"
    : t.stormIncoming
      ? "incoming"
      : "none";
  /**
   * The timeline renders the storm phase without a numeric countdown, because
   * the mod emits storm PRESENCE only: `stormIncoming` and `stormInProgress`
   * are bools and there is no onset or clear clock behind them. A countdown
   * would need a mod-side storm-onset clock on the Topic, which Kerbalism
   * tracks internally but does not currently surface.
   */
  // Reported per second, read per hour: a scale change the registry knows,
  // rather than a bare 3600 sitting next to a comment saying which end it is.
  const radiationRadPerHour = value(
    "rad/s",
    magnitudeOr(t.radiationRadPerSecond, 0),
  ).in("rad/h").magnitude;
  const innerBelt = t.innerBelt ?? false;
  const outerBelt = t.outerBelt ?? false;
  const magnetosphere = t.magnetosphere ?? false;

  const altitudeM = magnitudeOf(flight?.altitudeAsl);

  return {
    readable: true,
    data: {
      radiationRadPerHour,
      stormState,
      innerBelt,
      outerBelt,
      magnetosphere,
      blackout: t.blackout ?? false,
      shieldingValue: magnitudeOr(t.shieldingAmount, 0),
      // (stormTimeSec removed: see the FUTURE note above.)
      shieldingCapacity: magnitudeOr(t.shieldingCapacity, 1),
      altitudeKm: altitudeM === null ? null : altitudeM / 1000,
      stars: t.stars ?? [],
      storms: t.storms ?? [],
      stormEjectionSpeedMps: magnitudeOf(t.stormEjectionSpeed),
      // Deterministic noise seed derived from the weather state itself (stable
      // across renders for snapshots; no Math.random, no clock/provider needed).
      seed:
        Math.round(radiationRadPerHour * 1000) +
        (magnetosphere ? 7 : 0) +
        (innerBelt ? 13 : 0) +
        (outerBelt ? 29 : 0) +
        (stormState === "inprogress"
          ? 101
          : stormState === "incoming"
            ? 53
            : 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so the noise chart is stable for snapshots. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rad/h -> 0..1 on a log scale so background (~0.01) is still visible next to storm (~5). */
function doseFraction(radPerHour: number): number {
  const lo = 0.005;
  const hi = 12; // inner belt ~10.4 rad/h pins near the top
  const r = Math.max(lo, Math.min(hi, radPerHour));
  return Math.log(r / lo) / Math.log(hi / lo);
}

type Tone = "go" | "info" | "warn" | "nogo";

function doseTone(radPerHour: number): Tone {
  if (radPerHour >= 3) return "nogo";
  if (radPerHour >= 0.5) return "warn";
  if (radPerHour >= 0.05) return "info";
  return "go";
}

const TONE_HEX: Record<Tone, string> = {
  go: "var(--color-status-go-bg)",
  info: "var(--color-status-info-bg)",
  warn: "var(--color-status-warning-bg)",
  nogo: "var(--color-status-nogo-bg)",
};

function statusFor(d: SpaceWeatherData): { label: string; tone: Tone } {
  if (d.stormState === "inprogress" || d.radiationRadPerHour >= 3)
    return { label: "Storm in progress", tone: "nogo" };
  if (d.stormState === "incoming" || d.innerBelt || d.outerBelt)
    return { label: "Exposed", tone: "warn" };
  if (!d.magnetosphere) return { label: "Unshielded", tone: "info" };
  return { label: "Sheltered", tone: "go" };
}

// ---------------------------------------------------------------------------
// Sun vantage
//
// What the SUN is doing, as distinct from what the craft is sitting in. A
// vessel cannot report its own blackout, because a blackout kills the downlink
// that would carry the report, so the ground has to predict from the star
// instead. Every star this vessel sees comes off `stars`; CME tracking comes
// off `storms`, star-agnostic, so a binary or trinary pack reads the same as a
// single sun.
//
// The CME timeline reads `stormState` ONLY, never `storm_generation` (the RNG
// schedule for the next roll, which is readable at all times whether or not a
// storm exists). Departure, transit progress and impact ETA all derive from
// `stormTime` / `dist` / `stormEjectionSpeed`, mirroring Kerbalism's own
// `Time_to_impact(dist) = dist / StormEjectionSpeed` exactly.
//
// Activity is a per-(body, star) fact, so each star gets its OWN ring and its
// own spikes rather than one diagram fusing every star's storms together. A
// single CME tracker below still aggregates every active storm across all
// stars, which reads fine as one list.
// ---------------------------------------------------------------------------

interface StormDerived {
  key: string;
  star: string;
  state: number;
  /** UT the CME departed the star; null when dist or the ejection speed is uncaptured. */
  departureUt: number | null;
  /** 0..100, transit progress toward `dist`. Only meaningful when departureUt is set. */
  progressPct: number;
  /** stormTime - now, seconds. Negative once the CME has arrived. */
  impactEtaSec: number | null;
  /** What the CME is aimed at; null on a stream whose mod predates named targets. */
  targetKind: KerbalismStormTargetKind | null;
  /** The target's name (body or vessel, per `targetKind`); null on an older stream. */
  targetName: string | null;
}

function deriveStorm(
  entry: KerbalismStormEntry,
  index: number,
  nowUt: number,
  stormEjectionSpeedMps: number | null,
): StormDerived {
  const state = magnitudeOf(entry.stormState) ?? 0;
  const stormTime = magnitudeOf(entry.stormTime);
  const dist = magnitudeOf(entry.dist);
  const impactEtaSec = stormTime !== null ? stormTime - nowUt : null;

  let departureUt: number | null = null;
  let progressPct = 0;
  if (
    stormTime !== null &&
    dist !== null &&
    stormEjectionSpeedMps !== null &&
    stormEjectionSpeedMps > 0
  ) {
    const transitSec = dist / stormEjectionSpeedMps;
    departureUt = stormTime - transitSec;
    progressPct =
      transitSec > 0
        ? Math.max(0, Math.min(100, ((nowUt - departureUt) / transitSec) * 100))
        : 100;
  }

  return {
    key: `${entry.star ?? "star"}-${index}`,
    star: entry.star ?? "Unknown star",
    state,
    departureUt,
    progressPct,
    impactEtaSec,
    targetKind: entry.targetKind ?? null,
    targetName: entry.targetName ?? null,
  };
}

function stormSeverity(state: number): Severity {
  return state >= 2 ? "critical" : "warning";
}

function stormLabel(state: number): string {
  return state >= 2 ? "Impact" : "Inbound";
}

/**
 * `Severity` to `Card`'s `tone`. Only the three severities this widget ever
 * produces (nominal / warning / critical) carry meaning; the rest fold to
 * `default` defensively, since `Severity` is the wider shared vocabulary.
 */
const SEVERITY_CARD_TONE: Record<Severity, ReadoutTone> = {
  nominal: "go",
  info: "default",
  caution: "warning",
  warning: "warning",
  critical: "alert",
  offline: "default",
};

const SEVERITY_HEX: Record<Severity, string> = {
  nominal: "var(--color-status-go-bg)",
  info: "var(--color-status-info-bg)",
  caution: "var(--color-status-warning-bg)",
  warning: "var(--color-status-warning-bg)",
  critical: "var(--color-status-nogo-bg)",
  offline: "var(--color-text-muted)",
};

/**
 * Warm star colour, never the app's brand green: a star's own light is a colour
 * fact rather than a status accent, so it must never read as "GO".
 */
const STAR_FILL = "var(--color-tag-yellow-fg)";

/**
 * `KerbalismStormTargetKind.Vessel`, as its ordinal.
 *
 * The ENUM'S VALUE lives in the Kerbalism Uplink's barrel, and importing a
 * value from there runs that client's `defineUplinkClient` registration at
 * module load, which throws in any tree with no host installed and is not a
 * component library's business to trigger. The type import at the top of this
 * file is erased and costs nothing; this is its runtime half.
 */
const STORM_TARGET_VESSEL: KerbalismStormTargetKind = 1;

/** Seeded per STAR, so a ring's shape is stable whichever other stars render beside it. */
function seedForStar(name: string): number {
  let s = name.length * 101 + 1;
  for (let i = 0; i < name.length; i++) s = (s * 31 + name.charCodeAt(i)) | 0;
  return s || 1;
}

/** Point at radius `r` (SVG units) and bearing `deg` (0 = up, clockwise), centred on (50, 50). */
function pointAt(r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: 50 + r * Math.sin(rad), y: 50 - r * Math.cos(rad) };
}

interface StarActivity {
  level: number;
  severity: Severity;
  /** This star's own active (nonzero-state) storms only. */
  storms: StormDerived[];
}

/**
 * A star's activity level in 0..1, honestly derived from whether and how
 * imminent an in-transit CME is for THIS star. 0 is no CME at all, a tight and
 * calm ring. It ramps toward 1 as an inbound CME's transit progress nears
 * impact, the same figure the tracker cards show, and an arrived CME reads as
 * the maximum. The level drives the ring's colour, weight, turbulence AND its
 * distance from the star, so quiet and active are never confusable.
 */
function starActivity(
  allStorms: StormDerived[],
  starName: string,
): StarActivity {
  const mine = allStorms.filter((s) => s.star === starName && s.state !== 0);
  if (mine.length === 0) return { level: 0, severity: "nominal", storms: [] };
  const severity: Severity = mine.some((s) => s.state >= 2)
    ? "critical"
    : "warning";
  const level = Math.max(
    ...mine.map((s) => {
      if (s.state >= 2) return 1;
      // Active, but transit has not been captured: half, so it never reads calm.
      if (s.departureUt === null) return 0.5;
      return Math.max(0.15, Math.min(1, s.progressPct / 100));
    }),
  );
  return { level, severity, storms: mine };
}

function ringGeometry(level: number) {
  return {
    baseR: 20 + level * 18,
    jitterAmp: 1.2 + level * 7,
    strokeWidth: 1 + level * 1.6,
    opacity: 0.4 + level * 0.5,
  };
}

function ringPathD(seed: number, level: number): string {
  const rng = mulberry32(seed);
  const { baseR, jitterAmp } = ringGeometry(level);
  const ringPoints = 28;
  let d = "";
  for (let i = 0; i <= ringPoints; i++) {
    const deg = (360 * i) / ringPoints;
    const jitter = (rng() - 0.5) * jitterAmp;
    const { x, y } = pointAt(baseR + jitter, deg);
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return `${d}Z`;
}

function ringColor(level: number, severity: Severity): string {
  return level <= 0 ? "var(--color-text-muted)" : SEVERITY_HEX[severity];
}

const cmeRingPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
`;

/**
 * The only animated cue in this widget, and only ever on an active ring. The
 * `prefers-reduced-motion` guard lives INSIDE the same rule as the animation:
 * wrapping the keyframes alone would leave it running for a reduced-motion
 * reader.
 */
const RingPath = styled.path<{ $active: boolean }>`
  ${({ $active }) =>
    $active &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: ${cmeRingPulse} 2.4s ease-in-out infinite;
      }
    `}
`;

/**
 * One star: the star itself, its own activity ring, and a directional spike per
 * active storm.
 *
 * Spike DIRECTION is explicitly representational. Kerbalism models CME emission
 * as radial from the source star and carries no bearing data at all, so spikes
 * fan out at fixed, evenly spaced angles rather than pointing at real geometry.
 * The existence of a spike is the honest signal; its angle is not.
 */
function StarDiagram({
  starName,
  activity,
  compact,
}: {
  starName: string;
  activity: StarActivity;
  compact: boolean;
}) {
  const seed = seedForStar(starName);
  const d = ringPathD(seed, activity.level);
  const { strokeWidth, opacity } = ringGeometry(activity.level);
  const color = ringColor(activity.level, activity.severity);
  const label =
    activity.level <= 0
      ? `Solar activity for ${starName}: baseline`
      : `Solar activity for ${starName}: ${
          activity.severity === "critical" ? "CME impacting" : "CME inbound"
        }`;

  return (
    <Box
      style={{
        flex: "0 0 auto",
        height: compact ? 56 : 76,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        role="img"
        aria-label={label}
      >
        <RingPath
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          opacity={opacity}
          $active={activity.level > 0}
        />
        {activity.storms.map((storm, i) => {
          const count = activity.storms.length;
          const centreDeg = (360 * i) / count;
          const tip = pointAt(46, centreDeg);
          const left = pointAt(24, centreDeg - 3);
          const right = pointAt(24, centreDeg + 3);
          return (
            <polygon
              key={storm.key}
              points={`${left.x},${left.y} ${tip.x},${tip.y} ${right.x},${right.y}`}
              fill={SEVERITY_HEX[stormSeverity(storm.state)]}
            />
          );
        })}
        <circle cx={50} cy={50} r={14} fill={STAR_FILL} />
      </svg>
    </Box>
  );
}

/**
 * Transit-progress colour. `ProgressBar` defaults to the brand green used
 * everywhere else to mean "on track", and a CME closing in is the opposite of
 * that: further along the bar means CLOSER to impact, so a green fill reads as
 * reassuring for what is a threat. Colour keys on imminence instead, cool while
 * the CME is far out, ramping through amber into red as it nears 100, and
 * pinned to red the instant it has arrived whatever the percentage says.
 */
function transitThreatColor(storm: StormDerived): string {
  if (storm.state >= 2) return "var(--color-status-nogo-bg)";
  if (storm.progressPct >= 66) return "var(--color-status-nogo-bg)";
  if (storm.progressPct >= 33) return "var(--color-status-warning-bg)";
  return "var(--color-status-info-fg)";
}

/**
 * One tracked CME.
 *
 * **Where the target name comes from.** Each storm entry names its own target
 * (`targetKind` plus `targetName`), because Kerbalism has two storm paths and
 * they aim at different things. Around a body the slot is the shared
 * `Storm.StormKey(body, star)` one and every vessel in that SOI sees the same
 * storm, so the body is the target. With no body SOI, `Storm.Update(Vessel)`
 * rolls per-vessel against that vessel's own sun distance, so the VESSEL is the
 * target and no other craft shares the storm: hence the "(current vessel)"
 * qualifier, which says the CME is aimed at this craft in deep space rather
 * than at a body it happens to be near.
 *
 * `vessel.state.parentBodyName` remains a fallback only, for a stream whose mod
 * predates the named-target capture. A stream carrying neither degrades to
 * "current body".
 */
function StormCard({
  storm,
  compact,
  fallbackBodyName,
}: {
  storm: StormDerived;
  compact: boolean;
  fallbackBodyName: string | undefined;
}) {
  const severity = stormSeverity(storm.state);
  const target = storm.targetName ?? fallbackBodyName ?? "current body";
  const verb = storm.state >= 2 ? "Impacting" : "Inbound to";
  // Only the per-vessel case gets a qualifier: a body target reads plainly.
  const qualifier =
    storm.targetKind === STORM_TARGET_VESSEL ? " (current vessel)" : "";

  return (
    <Card tone={SEVERITY_CARD_TONE[severity]}>
      <Stack gap="xs">
        <Cluster justify="between" align="baseline">
          <Text tone="default" weight="semibold" size="sm">
            {storm.star}
          </Text>
          <Badge severity={severity} size="sm">
            {stormLabel(storm.state)}
          </Badge>
        </Cluster>

        <Text tone="muted" size="xs">
          {`${verb} ${target}${qualifier}`}
        </Text>

        {storm.departureUt !== null ? (
          <>
            {!compact && (
              <Cluster justify="between">
                <Text tone="muted" size="xs">
                  Departed
                </Text>
                <Text tone="default" size="xs">
                  <MissionDate value={storm.departureUt} />
                </Text>
              </Cluster>
            )}
            <ProgressBar
              value={storm.progressPct}
              ariaLabel={`Transit progress from ${storm.star}`}
              fillColor={transitThreatColor(storm)}
            />
          </>
        ) : (
          <Text tone="muted" size="xs">
            Transit data not yet captured.
          </Text>
        )}

        <Cluster justify="between">
          <Text tone="muted" size="xs">
            Impact
          </Text>
          <Text
            tone={storm.state >= 2 ? "nogo" : "warn"}
            size="xs"
            weight="semibold"
            // `warn` alone renders --color-status-warning-fg, a near-black
            // meant for text ON the warning "-bg" orange, e.g. inside a Badge;
            // standalone on this card's raised dark surface that is
            // functionally invisible. The `-fg-muted` override is the fix.
            // `nogo`'s own `-fg` is a light pink and needs none.
            style={
              storm.state < 2
                ? { color: "var(--color-status-warning-fg-muted)" }
                : undefined
            }
          >
            {storm.impactEtaSec !== null ? (
              <Countdown value={storm.impactEtaSec} clock />
            ) : (
              "unknown"
            )}
          </Text>
        </Cluster>
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections (inline SVG: the harness rasterises SVG + a Playwright PNG)
// ---------------------------------------------------------------------------

function StormTimeline({ state }: { state: StormState }) {
  // Phases along a fixed axis: quiet | incoming | in-progress | passed.
  const phases = [
    { key: "quiet", label: "Quiet", tone: "go" as Tone, w: 34 },
    { key: "incoming", label: "Incoming", tone: "warn" as Tone, w: 22 },
    { key: "inprogress", label: "Storm", tone: "nogo" as Tone, w: 22 },
    { key: "passed", label: "Passed", tone: "go" as Tone, w: 22 },
  ];
  // "now" marker position (0..100) by state.
  const nowPct = state === "none" ? 17 : state === "incoming" ? 45 : 67;
  // Phase only: no numeric countdown (the mod emits storm presence, not a
  // clock; see the FUTURE note in useSpaceWeather).
  const headline =
    state === "inprogress"
      ? "Storm in progress"
      : state === "incoming"
        ? "CME inbound"
        : "No storm activity";
  let acc = 0;
  return (
    <Section style={STAT_SECTION}>
      <div style={SECTION_HEAD}>
        <span style={SECTION_LABEL}>Storm forecast</span>
        <span style={sectionValueStyle(state === "none" ? "go" : "warn")}>
          {headline}
        </span>
      </div>
      <svg
        viewBox="0 0 100 14"
        preserveAspectRatio="none"
        width="100%"
        height="16"
        role="img"
        aria-label={headline}
      >
        {phases.map((p) => {
          const x = acc;
          acc += p.w;
          return (
            <rect
              key={p.key}
              x={x}
              y={3}
              width={p.w - 0.6}
              height={8}
              rx={1}
              fill={TONE_HEX[p.tone]}
              opacity={0.9}
            />
          );
        })}
        <line
          x1={nowPct}
          y1={0}
          x2={nowPct}
          y2={14}
          stroke="var(--color-text-primary)"
          strokeWidth={0.8}
        />
        <circle cx={nowPct} cy={1.6} r={1.6} fill="var(--color-text-primary)" />
      </svg>
    </Section>
  );
}

function BeltRings({
  inner,
  outer,
  magnetosphere,
  altitudeKm,
}: {
  inner: boolean;
  outer: boolean;
  magnetosphere: boolean;
  altitudeKm: number | null;
}) {
  // Kerbin R=600km; magnetopause ~7590km altitude. Draw rings scaled into a
  // 100-unit box (radius units): body 12, inner belt 26, outer belt 40, pause 48.
  const cx = 50;
  const cy = 50;
  const rings = [
    {
      r: 48,
      tone: "info" as Tone,
      label: "Magnetopause",
      active: magnetosphere,
    },
    { r: 40, tone: "warn" as Tone, label: "Outer belt", active: outer },
    { r: 26, tone: "nogo" as Tone, label: "Inner belt", active: inner },
  ];
  // Vessel radius in box units. When the vessel is IN a belt, snap the dot onto
  // that belt's ring so the "you are here" dot sits on the lit band (the belt
  // bool is authoritative for membership; the ring radii are fixed visual
  // bands, not an altitude scale). Outside any belt, fall back to the altitude
  // map (0..8000km across body(12)..pause(48)): correct for the low-orbit /
  // between-bands case.
  //
  // `null` when neither a belt nor a current altitude places it, and then no dot
  // is drawn at all. Coercing an absent altitude to 0 km puts the craft on the
  // body's surface: a landed vessel, drawn from nothing.
  const vr =
    inner || outer
      ? inner
        ? 26
        : 40
      : altitudeKm === null
        ? null
        : 12 + Math.min(1, Math.max(0, altitudeKm / 8000)) * 36;
  const vesselTone: Tone = inner
    ? "nogo"
    : outer
      ? "warn"
      : magnetosphere
        ? "go"
        : "info";
  return (
    <svg
      viewBox="0 0 100 100"
      // Sizing lived in RingsSlot's `& > svg` rule (not expressible inline);
      // it belongs on the element it sizes, so it moves here.
      style={{
        maxHeight: "100%",
        maxWidth: "100%",
        width: "auto",
        height: "100%",
      }}
      role="img"
      aria-label={
        vr === null
          ? "Radiation belts, vessel position unknown"
          : "Radiation belt position"
      }
    >
      {rings.map((ring) => (
        <circle
          key={ring.label}
          cx={cx}
          cy={cy}
          r={ring.r}
          fill="none"
          stroke={TONE_HEX[ring.tone]}
          strokeWidth={ring.active ? 2.4 : 1}
          opacity={ring.active ? 1 : 0.35}
          strokeDasharray={ring.active ? undefined : "2 2"}
        />
      ))}
      {/* faint belt fill when the vessel is inside one */}
      {outer && !inner && (
        <circle cx={cx} cy={cy} r={40} fill={TONE_HEX.warn} opacity={0.08} />
      )}
      {inner && (
        <circle cx={cx} cy={cy} r={26} fill={TONE_HEX.nogo} opacity={0.1} />
      )}
      {/* body */}
      <circle
        cx={cx}
        cy={cy}
        r={12}
        fill="var(--color-accent-fg)"
        opacity={0.85}
      />
      {/* vessel, only where it can honestly be placed */}
      {vr !== null && (
        <circle
          cx={cx + vr}
          cy={cy}
          r={3}
          fill={TONE_HEX[vesselTone]}
          stroke="var(--color-text-primary)"
          strokeWidth={0.6}
        />
      )}
    </svg>
  );
}

function SolarWindChart({
  radiation,
  storm,
  seed,
  points = 64,
}: {
  radiation: number;
  storm: boolean;
  seed: number;
  points?: number;
}) {
  const rng = mulberry32(seed || 1);
  // Amplitude from the dose fraction; storms get extra violence.
  const amp = (0.12 + doseFraction(radiation) * 0.8) * (storm ? 1.25 : 1);
  const tone = doseTone(radiation);
  const W = 100;
  const H = 30;
  const mid = H * 0.55;
  const step = W / (points - 1);
  let d = `M 0 ${mid.toFixed(2)}`;
  for (let i = 0; i < points; i++) {
    const x = i * step;
    // layered noise for a solar-wind feel
    const n = (rng() - 0.5) * 2 + (rng() - 0.5);
    const y = Math.max(1, Math.min(H - 1, mid - n * amp * mid));
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  const area = `${d} L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="Solar-wind and radiation-field flux"
    >
      <path d={area} fill={TONE_HEX[tone]} opacity={0.16} />
      <path d={d} fill="none" stroke={TONE_HEX[tone]} strokeWidth={0.9} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

function SpaceWeatherComponent({
  w,
  h,
}: Readonly<ComponentProps<SpaceWeatherConfig>>) {
  const read = useSpaceWeather();
  // Both read unconditionally, ahead of the absence branch below, so the hook
  // order is the same on every render.
  const nowUt = magnitudeOr(useViewUt(), 0);
  // Only the FALLBACK target name, for a stream whose mod predates the
  // named-target capture; see `StormCard`.
  const fallbackBodyName =
    useStream<VesselState>("vessel.state")?.parentBodyName ?? undefined;

  if (!read.readable) {
    // No verdict badge in the header either: "Sheltered" is a claim about a
    // habitat, and the whole point of getting here is that there is nothing to
    // make it from.
    return (
      <Panel panelTitle="Space Weather" compactTitle={["SPACE WX", "WX"]}>
        <EmptyState layout="fill" role="status" aria-live="polite">
          {ABSENCE_TEXT[read.absence]}
        </EmptyState>
      </Panel>
    );
  }

  const d = read.data;
  const status = statusFor(d);
  // The rings can place the dot from a belt bool alone, so the altitude only
  // goes missing from the diagram when neither belt claims the craft.
  const positionUnknown = d.altitudeKm === null && !d.innerBelt && !d.outerBelt;
  const cols = w ?? 8;
  const rows = h ?? 8;
  // The full board needs both width (rings + dose side by side, dose value on
  // one line) and height (five stacked sections). Below either threshold,
  // compact sheds the solar-wind chart + env tags and shrinks the readout.
  const compact = cols < 7 || rows < 6;

  const doseText = `${d.radiationRadPerHour.toFixed(d.radiationRadPerHour < 1 ? 3 : 2)} rad/h`;
  const shieldFrac =
    d.shieldingCapacity > 0 ? d.shieldingValue / d.shieldingCapacity : 0;

  const allStorms = d.storms.map((s, i) =>
    deriveStorm(s, i, nowUt, d.stormEjectionSpeedMps),
  );
  const activeStorms = allStorms.filter((s) => s.state !== 0);

  return (
    <Panel
      panelTitle="Space Weather"
      compactTitle={["SPACE WX", "WX"]}
      panelAside={
        <Badge
          role="status"
          aria-live="polite"
          severity={
            status.tone === "go"
              ? "nominal"
              : status.tone === "nogo"
                ? "critical"
                : "warning"
          }
        >
          {status.label}
        </Badge>
      }
    >
      {/* Sun vantage first: the widget's subject is what the STAR is doing,
          and the vessel-local consequence below is downstream of it. */}
      <Section>
        <SectionTitle>Stars</SectionTitle>
        {d.stars.length === 0 ? (
          <EmptyState>No stars detected yet.</EmptyState>
        ) : (
          // `justify="start"`, not Cluster's default `between`: with one or two
          // stars, space-between shoves the cards to opposite edges with a
          // canyon between them, which reads as broken rather than as "not much
          // going on". Packing left with a fixed card width is what scales from
          // a lone star to a five-star system, wrapping instead of stretching.
          <Cluster gap="sm" wrap justify="start">
            {d.stars.map((star) => {
              const name = star.star ?? "Unknown star";
              const activity = starActivity(allStorms, name);
              return (
                <Card
                  key={name}
                  tone={SEVERITY_CARD_TONE[activity.severity]}
                  // Fixed width, not a minWidth: every card is the same size
                  // whatever the star's name length, so a row packs and wraps
                  // predictably. flexShrink 0 keeps that width honest under
                  // `wrap`, so the browser wraps rather than squeezing.
                  style={{ width: 128, flexShrink: 0 }}
                >
                  <Stack gap="xs">
                    <StarDiagram
                      starName={name}
                      activity={activity}
                      compact={compact}
                    />
                    <Text tone="default" weight="semibold" size="sm">
                      {name}
                    </Text>
                    <Text tone="muted" size="xs">
                      <Unit value={star.distance} />
                    </Text>
                  </Stack>
                </Card>
              );
            })}
          </Cluster>
        )}
      </Section>

      <Section>
        <SectionTitle>CME tracker</SectionTitle>
        {activeStorms.length === 0 ? (
          <EmptyState>No inbound CMEs detected.</EmptyState>
        ) : (
          <Stack gap="sm">
            {activeStorms.map((storm) => (
              <StormCard
                key={storm.key}
                storm={storm}
                compact={compact}
                fallbackBodyName={fallbackBodyName}
              />
            ))}
          </Stack>
        )}
      </Section>

      <StormTimeline state={d.stormState} />

      <div style={midRowStyle(compact)}>
        <div style={RINGS_SLOT}>
          <BeltRings
            inner={d.innerBelt}
            outer={d.outerBelt}
            magnetosphere={d.magnetosphere}
            altitudeKm={d.altitudeKm}
          />
          {positionUnknown && (
            // Says WHY the dot is gone. A diagram missing its "you are here"
            // marker otherwise reads as a widget that failed to draw one.
            <span style={POSITION_UNKNOWN_TAG}>Position unknown</span>
          )}
          {d.blackout && <span style={BLACKOUT_TAG}>Comms blackout</span>}
        </div>
        <div style={DOSE_SLOT}>
          <div style={doseValueStyle(doseTone(d.radiationRadPerHour), compact)}>
            {doseText}
          </div>
          <div style={DOSE_CAPTION}>habitat dose rate</div>
        </div>
      </div>

      {!compact && (
        <div style={FLUX_SECTION}>
          <ReadoutCaption style={SPACED_CAPTION}>
            Solar-wind flux
          </ReadoutCaption>
          <div style={CHART_SLOT}>
            <SolarWindChart
              radiation={d.radiationRadPerHour}
              storm={d.stormState === "inprogress"}
              seed={d.seed}
            />
          </div>
        </div>
      )}

      <div style={FOOTER_ROW}>
        <Meter
          label="Shielding"
          value={shieldFrac}
          tone={shieldFrac >= 0.6 ? "go" : shieldFrac >= 0.3 ? "warn" : "nogo"}
          valueLabel={`${d.shieldingValue.toFixed(1)} / ${d.shieldingCapacity.toFixed(1)}`}
          size={compact ? "sm" : "md"}
        />
        {!compact && (
          <div style={ENV_ROW}>
            <span style={envTagStyle(d.magnetosphere)}>Magnetosphere</span>
            <span style={envTagStyle(d.outerBelt, "warn")}>Outer belt</span>
            <span style={envTagStyle(d.innerBelt, "nogo")}>Inner belt</span>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

// Structural inline styles (CSS-var tokens): a chrome-heavy readout, no
// reusable ui-kit primitive fits the bespoke belt/dose/flux layout, so it
// stays local rather than carrying styled-components into the widget. The
// two ui-kit pieces it does reuse (Section, ReadoutCaption) keep their kit
// type treatment and take only this widget's spacing inline.

// Same shape as LifeSupportSystems': the kit's Section plus the spacing
// above it, which is the only part that is this widget's business.
const STAT_SECTION: CSSProperties = { marginTop: "var(--space-8)" };

const SECTION_HEAD: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "var(--space-8)",
};

const SECTION_LABEL: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

function sectionValueStyle(tone: Tone): CSSProperties {
  return {
    fontSize: "var(--font-size-xs)",
    color: TONE_HEX[tone],
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

function midRowStyle(compact: boolean): CSSProperties {
  return {
    flex: "0 0 auto",
    height: compact ? "68px" : "86px",
    display: "grid",
    gridTemplateColumns: compact
      ? "minmax(64px, 36%) 1fr"
      : "minmax(90px, 42%) 1fr",
    alignItems: "stretch",
    gap: "var(--space-12)",
    marginTop: compact ? "var(--space-4)" : "var(--space-10)",
    minHeight: 0,
    overflow: "hidden",
  };
}

const FLUX_SECTION: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
  marginTop: "var(--space-10)",
  minHeight: 0,
};

// The `& > svg` sizing that lived here now sits inline on the BeltRings <svg>.
const RINGS_SLOT: CSSProperties = {
  position: "relative",
  height: "100%",
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

const BLACKOUT_TAG: CSSProperties = {
  position: "absolute",
  bottom: "2px",
  left: "50%",
  transform: "translateX(-50%)",
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  // Text sitting ON the nogo-bg fill, not beside it: -fg (2.61:1 here) fails
  // the 4.5:1 AA floor. -on-bg is the token for exactly this case.
  color: "var(--color-status-nogo-on-bg)",
  background: "var(--color-status-nogo-bg)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-hair) var(--space-6)",
  whiteSpace: "nowrap",
};

// Same corner treatment as the blackout tag, pinned to the top of the diagram so
// the two can show together, and muted rather than toned: it reports a gap in
// what we know, not a hazard.
const POSITION_UNKNOWN_TAG: CSSProperties = {
  position: "absolute",
  top: "2px",
  left: "50%",
  transform: "translateX(-50%)",
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-hair) var(--space-6)",
  whiteSpace: "nowrap",
};

const DOSE_SLOT: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
};

// A prop-driven display tier ABOVE the 16px top of the type scale, so no token
// rung fits; hoisted to named constants per the token-ratchet convention for
// deliberately off-ladder values (the constant is the documentation). The 1.05
// line-height is tuned to this size: a body line-height clips descenders on a
// readout this large.
const DOSE_FONT_COMPACT = "19px";
const DOSE_FONT_FULL = "23px";

function doseValueStyle(tone: Tone, compact: boolean): CSSProperties {
  return {
    fontSize: compact ? DOSE_FONT_COMPACT : DOSE_FONT_FULL,
    fontWeight: 700,
    lineHeight: 1.05,
    color: TONE_HEX[tone],
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  };
}

const DOSE_CAPTION: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

// ReadoutCaption, not FieldLabel: these caption read-only values, and the
// kit's FieldLabel is a <label>, which belongs to a form control. Only the
// spacing above is this widget's; the type treatment is the kit's.
const SPACED_CAPTION: CSSProperties = {
  display: "block",
  marginTop: "var(--space-8)",
};

const CHART_SLOT: CSSProperties = {
  flex: "0 0 auto",
  height: "44px",
  width: "100%",
};

const FOOTER_ROW: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
  marginTop: "auto",
  paddingTop: "var(--space-6)",
};

const ENV_ROW: CSSProperties = {
  display: "flex",
  gap: "var(--space-6)",
  flexWrap: "wrap",
};

function envTagStyle(on: boolean, tone?: Tone): CSSProperties {
  const active = TONE_HEX[tone ?? "go"];
  return {
    fontSize: "var(--font-size-2xs)",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    padding: "var(--space-hair) var(--space-6)",
    borderRadius: "var(--radius-sm)",
    border: `1px solid ${on ? active : "var(--color-border-subtle)"}`,
    color: on ? active : "var(--color-text-muted)",
    opacity: on ? 1 : 0.5,
    whiteSpace: "nowrap",
  };
}

registerComponent<SpaceWeatherConfig>({
  id: "space-weather",
  name: "Space Weather",
  description:
    "Sun vantage plus vessel exposure: a per-star activity diagram for every star this vessel sees and a CME tracker (departure, transit progress, impact ETA, and the named target, the body below or the vessel itself out in solar orbit), then the craft's own habitat dose rate, belt/magnetopause position rings and shielding.",
  tags: ["telemetry", "kerbalism"],
  defaultSize: { w: 8, h: 11 },
  minSize: { w: 3, h: 4 },
  component: SpaceWeatherComponent,
  channels: ["kerbalism.spaceweather"],
  optionalChannels: ["vessel.flight"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
  owner: KERBALISM,
});

export { SpaceWeatherComponent };
