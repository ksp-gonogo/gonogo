import type { BodyDefinition, CurrentOrbit, DataKey } from "@ksp-gonogo/core";
import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Button, GhostButton } from "@ksp-gonogo/ui";
import {
  Countdown,
  SectionTitle,
  SignalDelayBadge,
  Unit,
} from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import {
  projectionDiffersFromTrajectory,
  TwoBodyProjectionNote,
} from "../shared/twoBodyProjection";
import { AvailableRow } from "./AvailableRow";
import { ManeuverDiagram } from "./ManeuverDiagram";
import { ProjectedRows } from "./ProjectedRows";
import { isSequence, type PlanResult } from "./planning";
import { SequencePreview } from "./SequencePreview";
import { ShortfallBanner } from "./ShortfallBanner";
import { Label, PreviewGrid, PreviewValue } from "./styles";
import { TriggerEditor } from "./TriggerEditor";
import type { ThresholdOp } from "./triggerTypes";
import type { SendDelay } from "./useNodeCommands";

export interface ManeuverPreviewProps {
  plan: PlanResult | null;
  currentOrbit: CurrentOrbit | null;
  body: BodyDefinition | undefined;
  preset: string;
  burnTrueAnomaly: number | null;
  /** The propagation seam's answer for the current orbit, the base curve; `null` when it could not be asked. */
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
  /** The light time a node crosses on its way to the craft, stated beside the send control. */
  sendDelay: SendDelay;
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
      {/* Above the plane caveat: it qualifies every readout, that one only the drawing. */}
      {projectionDiffersFromTrajectory(props.currentTrajectory) && (
        <Note>
          <TwoBodyProjectionNote />
        </Note>
      )}
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
        {/* One group, so a narrow row wraps the light time with the control it qualifies. */}
        <SendGroup>
          {props.sendDelay.oneWaySeconds !== null &&
            props.sendDelay.oneWaySeconds > 0 && (
              <SignalDelayBadge
                oneWaySeconds={props.sendDelay.oneWaySeconds}
                delayReading={props.sendDelay.reading}
              />
            )}
          <Button
            onClick={() => void props.onCommit()}
            disabled={props.committing || props.feasible === false}
          >
            {props.committing ? "Adding..." : "Add node"}
          </Button>
        </SendGroup>
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

      <AvailableRow availableDeltaV={availableDeltaV} feasible={feasible} />

      <ProjectedRows projected={plan.projected} body={body} />
    </PreviewGrid>
  );
}

const PreviewSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding-top: var(--gap-planner-section);
`;

const PreviewContainer = styled.div`
  container-type: inline-size;
`;

const PreviewMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);

  @container (min-width: 460px) {
    flex-direction: row;
    align-items: flex-start;
    gap: var(--gap-section);
  }
`;

const PreviewReadouts = styled.div`
  min-width: 0;

  @container (min-width: 460px) {
    flex: 0 0 auto;
  }
`;

const Note = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-dim);
  font-style: italic;
`;

const ErrorLine = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-nogo-text);
  background: var(--color-tag-dark-brown-bg);
  border: 1px solid var(--color-border-strong);
  padding: var(--inset-surface);
  border-radius: var(--radius-regular);
`;

const CommitRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--gap-related);
  padding-top: var(--gap-actions);
`;

const SendGroup = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
`;
