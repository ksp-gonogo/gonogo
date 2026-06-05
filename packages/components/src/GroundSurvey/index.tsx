import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import { registerComponent } from "@gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Panel,
  PanelSubtitle,
  PanelTitle,
  PrimaryButton,
} from "@gonogo/ui";
import { useEffect, useState } from "react";
import styled from "styled-components";
import { useElementSize } from "../shared/useElementSize";
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

  // Selective rendering — badge is the headline; strip and supporting
  // readouts drop as height/width shrink.
  const cols = w ?? 8;
  const rows = h ?? 7;
  const showStrip = rows >= 5;
  const showSubtitle = rows >= 4;
  const showSpeed = cols >= 5 && rows >= 4;
  const showPrediction =
    rows >= 4 && survey.predictedLat !== null && survey.predictedLon !== null;

  return (
    <Panel>
      <Header>
        <Titles>
          <PanelTitle>GROUND SURVEY</PanelTitle>
          {showSubtitle && (
            <PanelSubtitle>
              {subtitleFor(survey, freezeBelowM, surveyCeilingM)}
            </PanelSubtitle>
          )}
          {showPrediction && (
            <PredictionReadout
              lat={survey.predictedLat as number}
              lon={survey.predictedLon as number}
            />
          )}
        </Titles>
        <BadgeArea>
          <SmoothnessBadge verdict={verdict} />
          {showSpeed && <SpeedReadout speed={survey.surfaceSpeed} />}
        </BadgeArea>
      </Header>
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

function subtitleFor(
  survey: ReturnType<typeof useGroundSurveySamples>,
  freezeBelowM: number,
  surveyCeilingM: number,
): string {
  if (survey.body === null) return "Awaiting telemetry…";
  const parts: string[] = [];
  parts.push(`${survey.body}`);
  const hft = survey.heightFromTerrain;
  if (hft !== null) {
    parts.push(`${formatMetres(hft)} AGL`);
  }
  if (survey.surveyState === "active") parts.push("surveying");
  else if (survey.surveyState === "frozen") {
    parts.push(`frozen (< ${formatMetres(freezeBelowM)} AGL)`);
  } else if (survey.surveyState === "above-ceiling") {
    parts.push(`above ceiling (> ${formatMetres(surveyCeilingM)} AGL)`);
  } else parts.push("idle");
  return parts.join(" · ");
}

function SmoothnessBadge({ verdict }: { verdict: SmoothnessVerdict | null }) {
  if (!verdict) return <BadgePlaceholder>—</BadgePlaceholder>;
  return (
    <BadgeWrap $tone={verdict.badge}>
      <BadgeGrade>{verdict.badge}</BadgeGrade>
      <BadgeLabel>{verdict.label}</BadgeLabel>
      <BadgeDelta>Δ {formatMetres(verdict.peakToTrough)}</BadgeDelta>
    </BadgeWrap>
  );
}

function SpeedReadout({ speed }: { speed: number | null }) {
  if (speed === null) return null;
  return <Speed>{speed.toFixed(0)} m/s surf.</Speed>;
}

function PredictionReadout({ lat, lon }: { lat: number; lon: number }) {
  return (
    <Prediction>
      Impact {formatCoord(lat, "lat")}, {formatCoord(lon, "lon")}
    </Prediction>
  );
}

function formatCoord(value: number, axis: "lat" | "lon"): string {
  const hemi =
    axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(2)}°${hemi}`;
}

function formatMetres(m: number): string {
  const abs = Math.abs(m);
  if (abs >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
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
          Above this height-above-terrain the strip stays idle — terrain
          readings from orbit smear over hundreds of km of ground per sample and
          the smoothness verdict becomes meaningless. Default 10 000 m, well
          below LKO and well above any useful reconnaissance pass.
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
          a flat dashed segment so the time-axis keeps scrolling. Default 1000 m
          — high enough to capture the survey from a low-orbit pass and freeze
          the verdict before final approach.
        </FieldHint>
      </Field>
      <PrimaryButton
        onClick={() => {
          const freeze = Number.parseInt(freezeBelowM, 10);
          const ceiling = Number.parseInt(surveyCeilingM, 10);
          onSave({
            freezeBelowM: Number.isFinite(freeze) && freeze > 0 ? freeze : 1000,
            surveyCeilingM:
              Number.isFinite(ceiling) && ceiling > 0 ? ceiling : 10_000,
          });
        }}
      >
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`;

const Titles = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
`;

const BadgeArea = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  /* Grow to full width when wrapped onto its own line at narrow widths so the
     badge + speed stay a coherent right-aligned cluster instead of floating
     mid-line. At wide widths Titles' flex-grow keeps this pinned top-right. */
  flex: 1 0 auto;
`;

const BadgeWrap = styled.div<{ $tone: SmoothnessVerdict["badge"] }>`
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 6px;
  border-radius: 2px;
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
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
`;

const BadgeLabel = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const BadgeDelta = styled.span`
  font-size: 10px;
  opacity: 0.85;
`;

const BadgePlaceholder = styled.div`
  font-size: 14px;
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
  margin-top: 2px;
`;

const StripWrap = styled.div`
  flex: 1;
  min-height: 100px;
  display: flex;
  margin-top: 6px;
  border: 1px solid var(--color-surface-panel);
  border-radius: 2px;
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
  dataRequirements: [
    "v.altitude",
    "v.heightFromTerrain",
    "v.surfaceSpeed",
    "v.body",
    "v.splashed",
    "land.predictedLat",
    "land.predictedLon",
  ],
  defaultConfig: { freezeBelowM: 1000, surveyCeilingM: 10_000 },
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { GroundSurveyComponent };
