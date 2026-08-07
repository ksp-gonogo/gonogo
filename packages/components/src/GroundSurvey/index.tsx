import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import { AugmentSlot, registerComponent } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  useElementSize,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { NULL_DISPLAY, Panel, Unit, writeQuantity } from "@ksp-gonogo/ui-kit";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { ProfileStrip } from "./ProfileStrip";
import {
  rateSmoothness,
  type SmoothnessVerdict,
  useGroundSurveySamples,
} from "./useGroundSurveySamples";

interface GroundSurveyConfig {
  /** Below this hft (m) the strip freezes. Default 1000. */
  freezeBelowM?: number;
  /** Above this hft (m) the strip stays idle. Default 10 000. */
  surveyCeilingM?: number;
}

/**
 * Props for `ground-survey.badges`: the widget's BROAD escape-hatch slot
 * for composable badges, rendered in the header beside the smoothness
 * badge. Meant for small inline status chips an Uplink wants next to the
 * verdict; badge augments read their own Topics via hooks, so only labelling
 * context is passed down.
 */
export interface GroundSurveyBadgesContext {
  /** Body currently being surveyed (`vessel.state.parentBodyName`), when known. */
  body: string | null;
  /** Survey phase driving the strip. */
  surveyState: "idle" | "active" | "frozen" | "above-ceiling";
}

// Co-located declaration-merge of this widget's slot ids → their props. Kept
// next to the widget (not in a central registry file) so parallel slot work
// on other widgets never collides on this seam.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "ground-survey.badges": GroundSurveyBadgesContext;
  }
}

function GroundSurveyComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<GroundSurveyConfig>>) {
  const freezeBelowM = config?.freezeBelowM ?? 1000;
  const surveyCeilingM = config?.surveyCeilingM ?? 10_000;
  const windowMs = 120_000;

  const survey = useGroundSurveySamples({
    freezeBelowM,
    surveyCeilingM,
    windowMs,
  });

  // Drive the right-edge of the strip with a low-rate clock so the line
  // keeps scrolling in idle / sparse-sample phases. 250 ms matches
  // Telemachus's default WS rate.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const { ref: wrapRef, size } = useElementSize({ w: 320, h: 160 });

  const verdict = rateSmoothness(survey.samples);

  // Selective rendering: badge is the headline; strip and supporting
  // readouts drop as height/width shrink.
  const cols = w ?? 8;
  const rows = h ?? 7;
  const showStrip = rows >= 5;
  const showSubtitle = rows >= 4;
  const showSpeed = cols >= 5 && rows >= 4;
  const showPrediction =
    rows >= 4 && survey.predictedLat !== null && survey.predictedLon !== null;

  // Slot props. `badges` carries only labelling context, badge
  // augments read their own Topics via hooks.
  const badgesContext: GroundSurveyBadgesContext = {
    body: survey.body,
    surveyState: survey.surveyState,
  };

  // The impact prediction sits alongside the survey meta line as a compact
  // caption at the top of the body: it is the same kind of thing as the line
  // above it, dim metadata describing the survey the title names, and it gates
  // on the same height tier (`rows >= 4`) as that meta line itself.
  const subtitle =
    showSubtitle || showPrediction ? (
      <>
        {showSubtitle && subtitleFor(survey, freezeBelowM, surveyCeilingM)}
        {showPrediction && (
          <PredictionReadout
            lat={survey.predictedLat as number}
            lon={survey.predictedLon as number}
          />
        )}
      </>
    ) : undefined;

  return (
    <Panel
      panelTitle="GROUND SURVEY"
      // The aside lays its children out as a wrapping row; this stack wants a
      // column, so it brings its own.
      panelAside={
        <BadgeArea>
          <SmoothnessBadge verdict={verdict} />
          {showSpeed && <SpeedReadout speed={survey.surfaceSpeed} />}
          <AugmentSlot name="ground-survey.badges" props={badgesContext} />
        </BadgeArea>
      }
    >
      {subtitle && <SurveyMeta>{subtitle}</SurveyMeta>}
      {showStrip && (
        <StripWrap ref={wrapRef}>
          <ProfileStrip
            samples={survey.samples}
            nowMs={now}
            windowMs={windowMs}
            width={size.w}
            height={size.h}
          />
        </StripWrap>
      )}
    </Panel>
  );
}

/**
 * Nodes rather than a string, because two of these parts are altitudes and a
 * quantity is rendered by `<Unit>`. `SurveyMeta` (the body caption this feeds)
 * takes a `ReactNode`, so the only thing that changes is the join.
 */
function subtitleFor(
  survey: ReturnType<typeof useGroundSurveySamples>,
  freezeBelowM: number,
  surveyCeilingM: number,
): ReactNode {
  if (survey.body === null) return "Awaiting telemetry...";
  const parts: ReactNode[] = [survey.body];
  const hft = survey.heightFromTerrain;
  if (hft !== null) {
    parts.push(
      <>
        <Metres m={hft} /> AGL
      </>,
    );
  }
  if (survey.surveyState === "active") parts.push("surveying");
  else if (survey.surveyState === "frozen") {
    parts.push(
      <>
        frozen (&lt; <Metres m={freezeBelowM} /> AGL)
      </>,
    );
  } else if (survey.surveyState === "above-ceiling") {
    parts.push(
      <>
        above ceiling (&gt; <Metres m={surveyCeilingM} /> AGL)
      </>,
    );
  } else parts.push("idle");
  return parts.map((part, i) => (
    // Positional key: the parts are built in a fixed order above and never
    // reordered, so the index IS their identity.
    // biome-ignore lint/suspicious/noArrayIndexKey: see above
    <Fragment key={i}>
      {i > 0 && " · "}
      {part}
    </Fragment>
  ));
}

function SmoothnessBadge({ verdict }: { verdict: SmoothnessVerdict | null }) {
  if (!verdict) return <BadgePlaceholder>{NULL_DISPLAY}</BadgePlaceholder>;
  return (
    <BadgeWrap $tone={verdict.badge}>
      <BadgeGrade>{verdict.badge}</BadgeGrade>
      <BadgeLabel>{verdict.label}</BadgeLabel>
      <BadgeDelta>
        Δ <Metres m={verdict.peakToTrough} />
      </BadgeDelta>
    </BadgeWrap>
  );
}

function SpeedReadout({ speed }: { speed: number | null }) {
  if (speed === null) return null;
  return (
    <Speed>
      <Unit value={value("m/s", speed)} decimals={0} /> surf.
    </Speed>
  );
}

function PredictionReadout({ lat, lon }: { lat: number; lon: number }) {
  return (
    <Prediction>
      Impact {formatCoord(lat, "lat")}, {formatCoord(lon, "lon")}
    </Prediction>
  );
}

// `deg`, not `value`: the parameter used to shadow the `value` helper this
// now calls.
function formatCoord(deg: number, axis: "lat" | "lon"): string {
  const hemi = axis === "lat" ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W";
  return `${writeQuantity(value("°", Math.abs(deg)), { decimals: 2 })}${hemi}`;
}

// The shared `length` ladder with this widget's own precision. A survey
// distance wants two decimals at the km rung (10 m of resolution over a
// traverse) and none at the metre rung, which is finer than the ladder's
// one-decimal default in one direction and coarser in the other. The rungs
// are shared; only the precision is local, and it is a prop rather than a
// reimplementation.
function Metres({ m }: { m: number }) {
  return <Unit value={value("m", m)} decimals={Math.abs(m) >= 1000 ? 2 : 0} />;
}

// ── Config ────────────────────────────────────────────────────────────────────

function GroundSurveyConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<GroundSurveyConfig>>) {
  const [freezeBelowM, setFreezeBelowM] = useState(
    String(config?.freezeBelowM ?? 1000),
  );
  const [surveyCeilingM, setSurveyCeilingM] = useState(
    String(config?.surveyCeilingM ?? 10_000),
  );

  const candidate = useMemo<GroundSurveyConfig>(() => {
    const freeze = Number.parseInt(freezeBelowM, 10);
    const ceiling = Number.parseInt(surveyCeilingM, 10);
    return {
      freezeBelowM: Number.isFinite(freeze) && freeze > 0 ? freeze : 1000,
      surveyCeilingM:
        Number.isFinite(ceiling) && ceiling > 0 ? ceiling : 10_000,
    };
  }, [freezeBelowM, surveyCeilingM]);

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="ground-survey-ceiling">
          Survey ceiling (m AGL)
        </FieldLabel>
        <Input
          id="ground-survey-ceiling"
          type="number"
          min={500}
          max={500_000}
          value={surveyCeilingM}
          onChange={(e) => setSurveyCeilingM(e.target.value)}
        />
        <FieldHint>
          Above this height-above-terrain the strip stays idle, terrain readings
          from orbit smear over hundreds of km of ground per sample and the
          smoothness verdict becomes meaningless. Default 10 000 m, well below
          LKO and well above any useful reconnaissance pass.
        </FieldHint>
      </Field>
      <Field>
        <FieldLabel htmlFor="ground-survey-freeze">
          Freeze threshold (m)
        </FieldLabel>
        <Input
          id="ground-survey-freeze"
          type="number"
          min={50}
          max={50_000}
          value={freezeBelowM}
          onChange={(e) => setFreezeBelowM(e.target.value)}
        />
        <FieldHint>
          Below this height-above-terrain the strip stops sampling and pads with
          a flat dashed segment so the time-axis keeps scrolling. Default 1000
          m, high enough to capture the survey from a low-orbit pass and freeze
          the verdict before final approach.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

/* A column inside the panel's aside slot, which lays its own children out as
   a wrapping row: the badge, the speed and any augment stack vertically and
   stay right-aligned to each other. The header row handles the wrapping onto
   a second line at narrow widths, so this no longer needs to grow to claim
   one. */
const BadgeArea = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
`;

const BadgeWrap = styled.div<{ $tone: SmoothnessVerdict["badge"] }>`
  display: flex;
  align-items: baseline;
  gap: var(--space-6);
  padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-xs);
  background: ${({ $tone }) =>
    $tone === "A" || $tone === "B"
      ? "var(--color-status-go-bg)"
      : $tone === "C"
        ? "var(--color-status-warning-bg)"
        : "var(--color-status-nogo-bg)"};
  color: ${({ $tone }) =>
    $tone === "A" || $tone === "B"
      ? "var(--color-status-go-fg)"
      : $tone === "C"
        ? "var(--color-text-primary)"
        : "var(--color-text-primary)"};
`;

const BadgeGrade = styled.span`
  font-size: var(--font-size-base);
  font-weight: 700;
  letter-spacing: 0.04em;
`;

const BadgeLabel = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const BadgeDelta = styled.span`
  font-size: var(--font-size-2xs);
  opacity: 0.85;
`;

const BadgePlaceholder = styled.div`
  font-size: var(--font-size-base);
  color: var(--color-text-faint);
`;

const Speed = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

const Prediction = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
  margin-top: var(--space-2);
`;

const SurveyMeta = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
`;

/* Keeps its own border and radius: it is a box that draws itself, not padding
   compensating for a padless panel. The `margin-top` that used to hold it off
   the header IS gone, though, the panel body's inset supplies that now. */
const StripWrap = styled.div`
  flex: 1;
  min-height: 100px;
  display: flex;
  border: 1px solid var(--color-surface-panel);
  border-radius: var(--radius-xs);
  svg {
    flex: 1;
  }
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<GroundSurveyConfig>({
  id: "ground-survey",
  name: "Ground Survey",
  description:
    "Lunar Lander-style terrain-elevation strip built from v.altitude − v.heightFromTerrain over the last 2 minutes. Smoothness badge (A/B/C/F) rates the area for landing; the strip freezes once the ship drops below 1 km AGL so the verdict reflects the survey, not the descent.",
  tags: ["telemetry", "landing"],
  defaultSize: { w: 8, h: 7 },
  minSize: { w: 3, h: 3 },
  component: GroundSurveyComponent,
  configComponent: GroundSurveyConfigComponent,
  dataRequirements: ["vessel.flight", "vessel.surface"],
  defaultConfig: { freezeBelowM: 1000, surveyCeilingM: 10_000 },
  actions: [],
  // Broad badges escape-hatch slot in the header meta row. No
  // filler ships here: that's an Uplink augment.
  augmentSlots: ["ground-survey.badges"],
  pushable: true,
  requires: ["flight"],
});

export { GroundSurveyComponent };
