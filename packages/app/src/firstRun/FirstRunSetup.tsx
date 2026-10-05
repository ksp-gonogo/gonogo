import { Button, Stack } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import { ConnectStep } from "./steps/ConnectStep";
import { ContainerStep } from "./steps/ContainerStep";
import { DoneStep } from "./steps/DoneStep";
import { HealthStep } from "./steps/HealthStep";
import { UplinkReadinessStep } from "./steps/UplinkReadinessStep";
import { WelcomeStep } from "./steps/WelcomeStep";

type SetupStep =
  | "welcome"
  | "container"
  | "connect"
  | "uplinks"
  | "health"
  | "done";

const ORDER: readonly SetupStep[] = [
  "welcome",
  "container",
  "connect",
  "uplinks",
  "health",
  "done",
];

const HEADING: Record<SetupStep, string> = {
  welcome: "Welcome",
  container: "Start the container",
  connect: "Connect to KSP",
  uplinks: "Uplinks",
  health: "Health check",
  done: "Done",
};

/**
 * The label on the button that leaves each step. The last one is "Finish"
 * rather than "Close" because the modal chrome already has a Close, and two
 * buttons of the same name in one dialog is a keyboard operator's problem.
 */
const ADVANCE_LABEL: Record<SetupStep, string> = {
  welcome: "Get started",
  container: "Connect to KSP",
  connect: "Check Uplinks",
  uplinks: "Review setup",
  health: "Next",
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
 * The setup an operator walks through the first time they open Gonogo. Between
 * a welcome and a close, each step is one instruction, the command that carries
 * it out, and a check the app runs by itself: the container, the connection to
 * the mod, each installed Uplink, then all three together.
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
    <Stack gap="related-comfortable">
      <StepHeading aria-live="polite">
        Step {index + 1} of {ORDER.length}: {HEADING[step]}
      </StepHeading>
      {step === "welcome" && <WelcomeStep />}
      {step === "container" && <ContainerStep />}
      {step === "connect" && <ConnectStep />}
      {step === "uplinks" && <UplinkReadinessStep />}
      {step === "health" && <HealthStep />}
      {step === "done" && <DoneStep />}
      <Nav>
        {index > 0 && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => setStep(ORDER[index - 1])}
          >
            Back
          </Button>
        )}
        <Button variant="primary" type="button" onClick={advance}>
          {ADVANCE_LABEL[step]}
        </Button>
      </Nav>
    </Stack>
  );
}

const StepHeading = styled.h3`
  margin: 0;
  font-size: var(--font-size-value);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border-subtle);
  padding-bottom: var(--gap-title-rule);
`;

const Nav = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-related);
`;
