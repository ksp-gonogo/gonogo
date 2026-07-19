import { GhostButton, PrimaryButton } from "@ksp-gonogo/ui";
import { Stack } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import { ResultsStep } from "./steps/ResultsStep";
import { SetupAssistStep } from "./steps/SetupAssistStep";

type WizardStep = "setup" | "results";

const STEP_LABELS: Record<WizardStep, string> = {
  setup: "Step 1 of 2 — Connect",
  results: "Step 2 of 2 — Uplinks",
};

/**
 * The Uplink Hub setup wizard
 * (`docs/superpowers/specs/2026-07-18-uplink-hub-wizard-design.md` §1-3).
 * This is the task-C slice of the full seven-step design: the setup-assist
 * step (reusing `SitrepConnection`) and the results/load step (`useUplinkGap`
 * + `loadUplinkById`). The welcome/scan/done steps and the first-run
 * auto-open host are a later task — this component is meant to be reached
 * from a persistent entry point (the Settings "Uplink Hub" tab) any time,
 * always starting at setup.
 *
 * Composed for embedding inside an existing modal (the Settings modal's
 * "Uplink Hub" tab) rather than opening a dialog of its own — no dialog
 * chrome here, just a step heading, the step body, and a nav footer.
 */
export function UplinkHubWizard() {
  const [step, setStep] = useState<WizardStep>("setup");

  return (
    <Stack gap="md">
      <Intro>
        Checks what your Gonogo mod reports and offers to load any Uplink client
        that isn't downloaded yet.
      </Intro>
      <StepHeading aria-live="polite">{STEP_LABELS[step]}</StepHeading>
      {step === "setup" ? <SetupAssistStep /> : <ResultsStep />}
      <Nav>
        {step === "results" && (
          <GhostButton type="button" onClick={() => setStep("setup")}>
            Back
          </GhostButton>
        )}
        {step === "setup" && (
          <PrimaryButton type="button" onClick={() => setStep("results")}>
            Next: Check Uplinks
          </PrimaryButton>
        )}
      </Nav>
    </Stack>
  );
}

const Intro = styled.p`
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: 1.5;
`;

const StepHeading = styled.h3`
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border-subtle);
  padding-bottom: 4px;
`;

const Nav = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;
