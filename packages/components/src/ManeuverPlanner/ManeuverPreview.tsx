import {
  type BodyDefinition,
  type CurrentOrbit,
  type DataKey,
  formatDistance,
  formatDuration,
  type ManeuverPlan,
  type ManeuverSequence,
} from "@gonogo/core";
import type { VesselDeltaV } from "@gonogo/data";
import { Button, GhostButton } from "@gonogo/ui";
import styled from "styled-components";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { isSequence, type PlanResult } from "./planning";
import {
  FeasibilityBanner,
  FeasibilityBannerBody,
  FeasibilityBannerTitle,
  FeasibilityChip,
} from "./styles";
import { TriggerEditor } from "./TriggerEditor";
import type { ThresholdOp } from "./triggerTypes";

interface ManeuverPreviewProps {
  plan: PlanResult | null;
  currentOrbit: CurrentOrbit | null;
  body: BodyDefinition | undefined;
  preset: string;
  burnTrueAnomaly: number | null;
  /** Live orbit scalars used by the diagram. */
  diagram: {
    sma: number | undefined;
    ecc: number | undefined;
    ApR: number | undefined;
    PeR: number | undefined;
    trueAnomaly: number | undefined;
    argPe: number | undefined;
  };
  prograde: number;
  radial: number;
  normal: number;
  setPrograde: (n: number) => void;
  setRadial: (n: number) => void;
  vesselDeltaV: VesselDeltaV;
  feasible: boolean | null;
  requiredDeltaV: number;
  currentUT: number | undefined;
  error: string | null;
  principia: boolean;
  committing: boolean;
  triggerEditorOpen: boolean;
  setTriggerEditorOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  numericKeys: DataKey[];
  onCommit: () => void | Promise<void>;
  onArm: (input: { dataKey: string; op: ThresholdOp; value: number }) => void;
}

export function ManeuverPreview(props: ManeuverPreviewProps) {
  const { plan } = props;
  if (!plan) return null;
  return (
    <PreviewSection>
      <SectionTitle>Preview</SectionTitle>
      <PreviewContainer>
        <PreviewMain>
          <PreviewReadouts>
            <PreviewBody {...props} />
          </PreviewReadouts>
          <ManeuverDiagram {...props} />
        </PreviewMain>
      </PreviewContainer>
      {props.normal !== 0 && (
        <Note>
          Normal component tilts the plane; projection shows in-plane shape
          only.
        </Note>
      )}
      <ShortfallBanner
        feasible={props.feasible}
        plan={plan}
        requiredDeltaV={props.requiredDeltaV}
        vesselDeltaV={props.vesselDeltaV}
      />
      {props.error && <ErrorLine>{props.error}</ErrorLine>}
      <TriggerEditor
        open={props.triggerEditorOpen}
        numericKeys={props.numericKeys}
        externallyDisabled={props.principia || !plan}
        onClose={() => props.setTriggerEditorOpen(false)}
        onArm={props.onArm}
      />
      <CommitRow>
        <GhostButton
          type="button"
          onClick={() => props.setTriggerEditorOpen((o) => !o)}
          disabled={props.committing || props.principia || !plan}
          aria-expanded={props.triggerEditorOpen}
        >
          Add Node When…
        </GhostButton>
        <Button
          onClick={() => void props.onCommit()}
          disabled={
            props.committing || props.principia || props.feasible === false
          }
        >
          {props.committing ? "Adding…" : "Add node"}
        </Button>
      </CommitRow>
    </PreviewSection>
  );
}

function PreviewBody({
  plan,
  body,
  vesselDeltaV,
  feasible,
  currentUT,
}: ManeuverPreviewProps) {
  if (!plan) return null;
  if (isSequence(plan)) {
    return (
      <SequencePreview
        seq={plan}
        body={body}
        vesselDeltaV={vesselDeltaV}
        feasible={feasible}
        currentUT={currentUT}
      />
    );
  }
  return (
    <PreviewGrid>
      <Label>ΔV</Label>
      <Value>{plan.requiredDeltaV.toFixed(1)} m/s</Value>

      <Label>Burn in</Label>
      <Value>{formatDuration(plan.ut - (currentUT ?? 0))}</Value>

      <Label>Available</Label>
      <Value>
        <ValueNum>
          {vesselDeltaV.totalVac === 0
            ? "—"
            : `${vesselDeltaV.totalVac.toFixed(0)} m/s`}
        </ValueNum>
        {feasible !== null && (
          <FeasibilityChip $ok={feasible}>
            {feasible ? "OK" : "SHORT"}
          </FeasibilityChip>
        )}
      </Value>

      <ProjectedRows projected={plan.projected} body={body} />
    </PreviewGrid>
  );
}

interface SequencePreviewProps {
  seq: ManeuverSequence;
  body: BodyDefinition | undefined;
  vesselDeltaV: VesselDeltaV;
  feasible: boolean | null;
  currentUT: number | undefined;
}

function SequencePreview({
  seq,
  body,
  vesselDeltaV,
  feasible,
  currentUT,
}: SequencePreviewProps) {
  const burn1 = seq.burns[0];
  const burn2 = seq.burns[1];
  return (
    <>
      <PreviewGrid>
        <Label>Total ΔV</Label>
        <Value>{seq.totalDeltaV.toFixed(1)} m/s</Value>

        <Label>Available</Label>
        <Value>
          <ValueNum>
            {vesselDeltaV.totalVac === 0
              ? "—"
              : `${vesselDeltaV.totalVac.toFixed(0)} m/s`}
          </ValueNum>
          {feasible !== null && (
            <FeasibilityChip $ok={feasible}>
              {feasible ? "OK" : "SHORT"}
            </FeasibilityChip>
          )}
        </Value>
      </PreviewGrid>

      <SectionTitle>Burn 1</SectionTitle>
      <PreviewGrid>
        <Label>ΔV</Label>
        <Value>{burn1.prograde.toFixed(1)} m/s prograde</Value>
        <Label>Burn in</Label>
        <Value>{formatDuration(burn1.ut - (currentUT ?? 0))}</Value>
        <ProjectedRows
          projected={seq.transferEllipse}
          body={body}
          prefix="Transfer"
        />
      </PreviewGrid>

      {burn2 && (
        <>
          <SectionTitle>Burn 2</SectionTitle>
          <PreviewGrid>
            <Label>ΔV</Label>
            <Value>{burn2.prograde.toFixed(1)} m/s prograde</Value>
            <Label>Burn in</Label>
            <Value>{formatDuration(burn2.ut - (currentUT ?? 0))}</Value>
            <ProjectedRows
              projected={seq.finalProjected}
              body={body}
              prefix="Final"
            />
          </PreviewGrid>
        </>
      )}
    </>
  );
}

interface ProjectedRowsProps {
  projected: ManeuverPlan["projected"] | null | undefined;
  body: BodyDefinition | undefined;
  prefix?: string;
}

function ProjectedRows({
  projected,
  body,
  prefix = "New",
}: ProjectedRowsProps) {
  if (!projected) {
    return (
      <>
        <Label>Projection</Label>
        <Value>escape / invalid</Value>
      </>
    );
  }
  return (
    <>
      <Label>{prefix} Ap</Label>
      <Value $accent="ap">
        {formatDistance(projected.ApR - (body?.radius ?? 0))}
      </Value>
      <Label>{prefix} Pe</Label>
      <Value $accent="pe">
        {formatDistance(projected.PeR - (body?.radius ?? 0))}
      </Value>
      <Label>{prefix} Ecc</Label>
      <Value>{projected.eccentricity.toFixed(4)}</Value>
      <Label>{prefix} T</Label>
      <Value>{formatDuration(projected.period)}</Value>
      {projected.inclination !== undefined && (
        <>
          <Label>{prefix} Inc</Label>
          <Value>{projected.inclination.toFixed(2)}°</Value>
        </>
      )}
    </>
  );
}

function ManeuverDiagram({
  plan,
  currentOrbit,
  body,
  preset,
  burnTrueAnomaly,
  diagram,
  prograde,
  radial,
  setPrograde,
  setRadial,
}: ManeuverPreviewProps) {
  if (!plan || !currentOrbit || !diagram.ApR || !diagram.PeR) return null;
  const customWithHandles =
    preset === "custom-apo" ||
    preset === "custom-peri" ||
    preset === "custom-ut";
  // For sequences, draw the transfer ellipse dashed (`projected`) and
  // the final orbit solid (`secondaryProjected`). For single-burn
  // plans, just the post-burn ellipse goes in `projected`.
  const projected = isSequence(plan) ? plan.transferEllipse : plan.projected;
  const secondaryProjected = isSequence(plan) ? plan.finalProjected : null;
  return (
    <DiagramWrap>
      <OrbitDiagram
        variant="mini"
        sma={diagram.sma ?? 0}
        ecc={diagram.ecc ?? 0}
        apoapsis={diagram.ApR}
        periapsis={diagram.PeR}
        trueAnomaly={diagram.trueAnomaly ?? 0}
        argPe={diagram.argPe ?? 0}
        bodyColor={body?.color}
        bodyRadius={body?.radius}
        projected={
          projected
            ? {
                sma: projected.sma,
                ecc: projected.eccentricity,
                apoapsis: projected.ApR,
                periapsis: projected.PeR,
              }
            : null
        }
        secondaryProjected={
          secondaryProjected
            ? {
                sma: secondaryProjected.sma,
                ecc: secondaryProjected.eccentricity,
                apoapsis: secondaryProjected.ApR,
                periapsis: secondaryProjected.PeR,
              }
            : null
        }
        maneuverHandles={
          burnTrueAnomaly !== null && customWithHandles
            ? {
                burnTrueAnomaly,
                prograde,
                radial,
                onPrograde: setPrograde,
                onRadial: setRadial,
              }
            : null
        }
      />
    </DiagramWrap>
  );
}

interface ShortfallBannerProps {
  feasible: boolean | null;
  plan: PlanResult;
  requiredDeltaV: number;
  vesselDeltaV: VesselDeltaV;
}

function ShortfallBanner({
  feasible,
  plan,
  requiredDeltaV,
  vesselDeltaV,
}: ShortfallBannerProps) {
  if (feasible !== false || !plan) return null;
  return (
    <FeasibilityBanner role="alert">
      <FeasibilityBannerTitle>
        ΔV shortfall — commit disabled
      </FeasibilityBannerTitle>
      <FeasibilityBannerBody>
        Required {requiredDeltaV.toFixed(0)} m/s · available{" "}
        {vesselDeltaV.totalVac.toFixed(0)} m/s ·{" "}
        {(requiredDeltaV - vesselDeltaV.totalVac).toFixed(0)} m/s short.
      </FeasibilityBannerBody>
    </FeasibilityBanner>
  );
}

const PreviewSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
`;

const SectionTitle = styled.h4`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  margin: 0 0 2px 0;
`;

const PreviewGrid = styled.dl`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 8px;
  align-items: baseline;
  margin: 0;
`;

const Label = styled.dt`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const accentColor = {
  ap: "var(--color-status-warning-bg)",
  pe: "var(--color-tag-blue-fg)",
};

const Value = styled.dd<{ $accent?: "ap" | "pe" }>`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  font-size: 13px;
  color: ${({ $accent }) => ($accent ? accentColor[$accent] : "var(--color-text-primary)")};
  letter-spacing: 0.03em;
  margin: 0;
`;

/** Number + unit stay glued together; only the trailing chip may wrap. */
const ValueNum = styled.span`
  white-space: nowrap;
`;

const PreviewContainer = styled.div`
  container-type: inline-size;
`;

const PreviewMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;

  /* Wide-short: readouts and diagram share a row instead of stacking with a
     large empty gutter. Narrow widths keep the natural single-column stack. */
  @container (min-width: 460px) {
    flex-direction: row;
    align-items: flex-start;
    gap: 16px;
  }
`;

const PreviewReadouts = styled.div`
  min-width: 0;

  @container (min-width: 460px) {
    flex: 0 0 auto;
  }
`;

const DiagramWrap = styled.div`
  height: 180px;
  flex-shrink: 0;
  display: flex;

  @container (min-width: 460px) {
    flex: 1 1 0;
    min-width: 0;
  }
`;

const Note = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  font-style: italic;
`;

const ErrorLine = styled.div`
  font-size: 11px;
  color: var(--color-status-nogo-fg);
  background: var(--color-tag-dark-brown-bg);
  border: 1px solid var(--color-border-strong);
  padding: 4px 6px;
  border-radius: 2px;
`;

const CommitRow = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
`;
