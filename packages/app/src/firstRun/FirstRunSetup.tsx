import { GhostButton, PrimaryButton, Stack } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import { ConnectStep } from "./steps/ConnectStep";
import { DoneStep } from "./steps/DoneStep";
import { UplinkReadinessStep } from "./steps/UplinkReadinessStep";
import { WelcomeStep } from "./steps/WelcomeStep";

type SetupStep = "welcome" | "connect" | "uplinks" | "done";

const ORDER: readonly SetupStep[] = ["welcome", "connect", "uplinks", "done"];

const HEADING: Record<SetupStep, string> = {
  welcome: "Welcome",
  connect: "Connect",
  uplinks: "Uplinks",
  done: "Done",
};

/**
 * The label on the button that leaves each step. The last one is "Finish"
 * rather than "Close" because the modal chrome already has a Close, and two
 * buttons of the same name in one dialog is a keyboard operator's problem.
 */
const ADVANCE_LABEL: Record<SetupStep, string> = {
  welcome: "Get started",
  connect: "Check Uplinks",
  uplinks: "Next",
  done: "Finish",
};

export interface FirstRunSetupProps {
  /**
   * Called from the last step's Close button, so the host can close the modal
   * it mounted this in.
   */
  onFinish?: () => void;
}

/**
 * The setup an operator walks through the first time they open Gonogo: what an
 * Uplink is, connecting to the mod, then a reading per installed Uplink saying
 * whether its client loaded.
 *
 * Composed for embedding inside an existing modal rather than opening a dialog
 * of its own, so there is no dialog chrome here: a step heading, the step body,
 * and a nav footer.
 */
export function FirstRunSetup({ onFinish }: Readonly<FirstRunSetupProps> = {}) {
  const [step, setStep] = useState<SetupStep>("welcome");
  const index = ORDER.indexOf(step);

  function advance() {
    if (step === "done") {
      onFinish?.();
      return;
    }
    setStep(ORDER[index + 1]);
  }

  return (
    <Stack gap="md">
      <StepHeading aria-live="polite">
        Step {index + 1} of {ORDER.length}: {HEADING[step]}
      </StepHeading>
      {step === "welcome" && <WelcomeStep />}
      {step === "connect" && <ConnectStep />}
      {step === "uplinks" && <UplinkReadinessStep />}
      {step === "done" && <DoneStep />}
      <Nav>
        {index > 0 && (
          <GhostButton type="button" onClick={() => setStep(ORDER[index - 1])}>
            Back
          </GhostButton>
        )}
        <PrimaryButton type="button" onClick={advance}>
          {ADVANCE_LABEL[step]}
        </PrimaryButton>
      </Nav>
    </Stack>
  );
}

const StepHeading = styled.h3`
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border-subtle);
  padding-bottom: var(--space-4);
`;

const Nav = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--space-8);
`;
