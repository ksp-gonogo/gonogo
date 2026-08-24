import type {
  BodyDefinition,
  CurrentOrbit,
  DataKey,
  ManeuverPlan,
  ManeuverSequence,
} from "@ksp-gonogo/core";
import { type OrbitTrajectory, useStream } from "@ksp-gonogo/sitrep-client";
import {
  apsidesExist,
  type ControlFrame,
  controlFrameLabel,
  frameCaveat,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Button, GhostButton } from "@ksp-gonogo/ui";
import {
  Countdown,
  NULL_DISPLAY,
  SectionTitle,
  Unit,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
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
  /**
   * The propagation seam's answer for the vessel's CURRENT orbit, which is the
   * base curve everything here is drawn on top of. `null` means the question
   * could not be put (no elements, no clock).
   */
  currentTrajectory: OrbitTrajectory | null;
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
  /** Vessel-total ΔV in m/s off the shared budget, `null` when there is no usable figure. */
  availableDeltaV: number | null;
  feasible: boolean | null;
  requiredDeltaV: number;
  currentUT: number | undefined;
  error: string | null;
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
      <SectionTitle as="h4">Preview</SectionTitle>
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
        availableDeltaV={props.availableDeltaV}
      />
      {props.error && <ErrorLine>{props.error}</ErrorLine>}
      <TriggerEditor
        open={props.triggerEditorOpen}
        numericKeys={props.numericKeys}
        externallyDisabled={!plan}
        onClose={() => props.setTriggerEditorOpen(false)}
        onArm={props.onArm}
      />
      <CommitRow>
        <GhostButton
          type="button"
          onClick={() => props.setTriggerEditorOpen((o) => !o)}
          disabled={props.committing || !plan}
          aria-expanded={props.triggerEditorOpen}
        >
          Add Node When...
        </GhostButton>
        <Button
          onClick={() => void props.onCommit()}
          disabled={props.committing || props.feasible === false}
        >
          {props.committing ? "Adding..." : "Add node"}
        </Button>
      </CommitRow>
    </PreviewSection>
  );
}

function PreviewBody({
  plan,
  body,
  availableDeltaV,
  feasible,
  currentUT,
}: ManeuverPreviewProps) {
  if (!plan) return null;
  if (isSequence(plan)) {
    return (
      <SequencePreview
        seq={plan}
        body={body}
        availableDeltaV={availableDeltaV}
        feasible={feasible}
        currentUT={currentUT}
      />
    );
  }
  return (
    <PreviewGrid>
      <Label>ΔV</Label>
      <PreviewValue>
        <Unit value={value("m/s", plan.requiredDeltaV)} decimals={1} />
      </PreviewValue>

      <Label>Burn in</Label>
      <PreviewValue>
        <Countdown value={plan.ut - (currentUT ?? 0)} />
      </PreviewValue>

      <Label>Available</Label>
      <PreviewValue>
        <ValueNum>
          {availableDeltaV === null ? (
            NULL_DISPLAY
          ) : (
            <Unit value={value("m/s", availableDeltaV)} decimals={0} />
          )}
        </ValueNum>
        {feasible !== null && (
          <FeasibilityChip $ok={feasible}>
            {feasible ? "OK" : "SHORT"}
          </FeasibilityChip>
        )}
      </PreviewValue>

      <ProjectedRows projected={plan.projected} body={body} />
    </PreviewGrid>
  );
}

interface SequencePreviewProps {
  seq: ManeuverSequence;
  body: BodyDefinition | undefined;
  /** Vessel-total ΔV in m/s off the shared budget, `null` when there is no usable figure. */
  availableDeltaV: number | null;
  feasible: boolean | null;
  currentUT: number | undefined;
}

function SequencePreview({
  seq,
  body,
  availableDeltaV,
  feasible,
  currentUT,
}: SequencePreviewProps) {
  const burn1 = seq.burns[0];
  const burn2 = seq.burns[1];
  return (
    <>
      <PreviewGrid>
        <Label>Total ΔV</Label>
        <PreviewValue>
          <Unit value={value("m/s", seq.totalDeltaV)} decimals={1} />
        </PreviewValue>

        <Label>Available</Label>
        <PreviewValue>
          <ValueNum>
            {availableDeltaV === null ? (
              NULL_DISPLAY
            ) : (
              <Unit value={value("m/s", availableDeltaV)} decimals={0} />
            )}
          </ValueNum>
          {feasible !== null && (
            <FeasibilityChip $ok={feasible}>
              {feasible ? "OK" : "SHORT"}
            </FeasibilityChip>
          )}
        </PreviewValue>
      </PreviewGrid>

      <SectionTitle as="h4">Burn 1</SectionTitle>
      <PreviewGrid>
        <Label>ΔV</Label>
        <PreviewValue>
          <Unit value={value("m/s", burn1.prograde)} decimals={1} /> prograde
        </PreviewValue>
        <Label>Burn in</Label>
        <PreviewValue>
          <Countdown value={burn1.ut - (currentUT ?? 0)} />
        </PreviewValue>
        <ProjectedRows
          projected={seq.transferEllipse}
          body={body}
          prefix="Transfer"
        />
      </PreviewGrid>

      {burn2 && (
        <>
          <SectionTitle as="h4">Burn 2</SectionTitle>
          <PreviewGrid>
            <Label>ΔV</Label>
            <PreviewValue>
              <Unit value={value("m/s", burn2.prograde)} decimals={1} />{" "}
              prograde
            </PreviewValue>
            <Label>Burn in</Label>
            <PreviewValue>
              <Countdown value={burn2.ut - (currentUT ?? 0)} />
            </PreviewValue>
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
  /**
   * What the operator's own view frame does to these two rows. A projected
   * apoapsis is still an apoapsis: it is defined against a centre, and the
   * frames defined by a pair of bodies do not have one, so a number here would
   * be exactly as meaningless as the same number on the current orbit.
   */
  const controlFrame = useStream<ControlFrame>("system.frame");
  const apsides = apsidesExist(controlFrame);

  if (!projected) {
    // Ordered ahead of the frame check on purpose: "this burn leaves no orbit"
    // is a fact about the PLAN, and a plan that does not work outranks a view
    // that cannot describe one that does.
    return (
      <>
        <Label>Projection</Label>
        <PreviewValue>escape / invalid</PreviewValue>
      </>
    );
  }
  if (apsides === "invalid") {
    // One row rather than two empty ones. The plan is real and still
    // committable; what is missing is a way to describe its result in the frame
    // the operator chose, and saying that once is clearer than saying it twice
    // beside labels that now name nothing.
    return (
      <>
        <Label>{prefix} apsides</Label>
        <PreviewValue title={frameCaveat(apsides, "apsides")}>
          {`none in ${controlFrameLabel(controlFrame) ?? "this frame"}`}
        </PreviewValue>
      </>
    );
  }
  return (
    <>
      <Label>{prefix} Ap</Label>
      <PreviewValue $accent="ap">
        <Unit value={value("m", projected.ApR - (body?.radius ?? 0))} />
      </PreviewValue>
      <Label>{prefix} Pe</Label>
      <PreviewValue $accent="pe">
        <Unit value={value("m", projected.PeR - (body?.radius ?? 0))} />
      </PreviewValue>
      <Label>{prefix} Ecc</Label>
      <PreviewValue>{projected.eccentricity.toFixed(4)}</PreviewValue>
      <Label>{prefix} T</Label>
      <PreviewValue>
        <Unit value={value("s", projected.period)} />
      </PreviewValue>
      {projected.inclination !== undefined && (
        <>
          <Label>{prefix} Inc</Label>
          <PreviewValue>
            <Unit value={value("°", projected.inclination)} decimals={2} />
          </PreviewValue>
        </>
      )}
    </>
  );
}

function ManeuverDiagram({
  plan,
  currentOrbit,
  currentTrajectory,
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
  // Every curve on this drawing rests on the current orbit: the base conic IS
  // it, and the projected ellipses are patched-conic extrapolations of the same
  // elements. So a refusal takes the whole drawing rather than one line of it.
  // Leaving the projections behind would put the strongest claim on screen, a
  // post-burn orbit, on top of elements nothing authorised a curve through.
  if (currentTrajectory?.shape === "withheld") {
    return (
      <DiagramWrap>
        <TrajectoryWithheldNote withheld={currentTrajectory} />
      </DiagramWrap>
    );
  }
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
        // The seam's answer, drawn as given. `null` on the conic arm, where the
        // diagram's own conic renderer is what the provider said is right.
        trajectoryPath={
          currentTrajectory?.shape === "arc" ? currentTrajectory.points : null
        }
        trajectoryFarEnd={
          currentTrajectory?.shape === "arc" ? currentTrajectory.farEnd : null
        }
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
  /** Vessel-total ΔV in m/s off the shared budget, `null` when there is no usable figure. */
  availableDeltaV: number | null;
}

function ShortfallBanner({
  feasible,
  plan,
  requiredDeltaV,
  availableDeltaV,
}: ShortfallBannerProps) {
  const available = availableDeltaV;
  // `feasible === false` already implies a real number (the planner only judges when it
  // has one), so this narrows for the compiler rather than guarding a reachable case.
  // A shortfall cannot be quoted without an available figure, and a spent craft's 0 is
  // a figure: that is the whole point of the total being nullable rather than zeroed.
  if (feasible !== false || !plan || available === null) return null;
  return (
    <FeasibilityBanner role="status" aria-live="polite">
      <FeasibilityBannerTitle>
        ΔV shortfall: can't add node
      </FeasibilityBannerTitle>
      <FeasibilityBannerBody>
        Required <Unit value={value("m/s", requiredDeltaV)} decimals={0} /> ·
        available <Unit value={value("m/s", available)} decimals={0} /> ·{" "}
        <Unit value={value("m/s", requiredDeltaV - available)} decimals={0} />{" "}
        short.
      </FeasibilityBannerBody>
    </FeasibilityBanner>
  );
}

const PreviewSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding-top: var(--space-4);
`;

const PreviewGrid = styled.dl`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-8);
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

const PreviewValue = styled.dd<{ $accent?: "ap" | "pe" }>`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-6);
  font-size: var(--font-size-sm);
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
  gap: var(--space-6);

  /* Wide-short: readouts and diagram share a row instead of stacking with a
     large empty gutter. Narrow widths keep the natural single-column stack. */
  @container (min-width: 460px) {
    flex-direction: row;
    align-items: flex-start;
    gap: var(--space-16);
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
  font-size: var(--font-size-xs);
  color: var(--color-status-nogo-fg);
  background: var(--color-tag-dark-brown-bg);
  border: 1px solid var(--color-border-strong);
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-xs);
`;

const CommitRow = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-8);
  padding-top: var(--space-4);
`;
