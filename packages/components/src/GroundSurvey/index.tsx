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
import { useEffect, useRef, useState } from "react";
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
}

function GroundSurveyComponent({
  config,
}: Readonly<ComponentProps<GroundSurveyConfig>>) {
  const freezeBelowM = config?.freezeBelowM ?? 1000;
  const windowMs = 120_000;

  const survey = useGroundSurveySamples({ freezeBelowM, windowMs });

  // Drive the right-edge of the strip with a low-rate clock so the line
  // keeps scrolling in idle / sparse-sample phases. 250 ms matches
  // Telemachus's default WS rate.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 160 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.contentRect.width > 0 && e.contentRect.height > 0) {
          setSize({
            w: Math.floor(e.contentRect.width),
            h: Math.floor(e.contentRect.height),
          });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const verdict = rateSmoothness(survey.samples);

  return (
    <Panel>
      <Header>
        <Titles>
          <PanelTitle>GROUND SURVEY</PanelTitle>
          <PanelSubtitle>{subtitleFor(survey, freezeBelowM)}</PanelSubtitle>
        </Titles>
        <BadgeArea>
          <SmoothnessBadge verdict={verdict} />
          <SpeedReadout speed={survey.surfaceSpeed} />
        </BadgeArea>
      </Header>
      <StripWrap ref={wrapRef}>
        <ProfileStrip
          samples={survey.samples}
          nowMs={now}
          windowMs={windowMs}
          width={size.w}
          height={size.h}
        />
      </StripWrap>
    </Panel>
  );
}

function subtitleFor(
  survey: ReturnType<typeof useGroundSurveySamples>,
  freezeBelowM: number,
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

  return (
    <ConfigForm>
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
          const parsed = Number.parseInt(freezeBelowM, 10);
          onSave({
            freezeBelowM: Number.isFinite(parsed) && parsed > 0 ? parsed : 1000,
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
`;

const Titles = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const BadgeArea = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
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
  defaultConfig: { freezeBelowM: 1000 },
  actions: [],
  pushable: true,
});

export { GroundSurveyComponent };
