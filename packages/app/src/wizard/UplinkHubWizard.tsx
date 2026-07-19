import { GhostButton, PrimaryButton } from "@ksp-gonogo/ui";
import { Stack } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import { DoneStep } from "./steps/DoneStep";
import { ResultsStep } from "./steps/ResultsStep";
import { SetupAssistStep } from "./steps/SetupAssistStep";
import { WelcomeStep } from "./steps/WelcomeStep";

type WizardStep = "welcome" | "setup" | "results" | "done";

function stepLabel(step: WizardStep, firstRun: boolean): string {
  // The persistent entry point (Settings "Uplink Hub" tab, `firstRun` unset)
  // keeps Task C's original two-step numbering unchanged. `firstRun` bookends
  // it with Welcome/Done (design §1 steps 1 and 7) — deferred by Task C, see
  // that task's report — renumbered as a four-step sequence.
  if (!firstRun) {
    return step === "setup" ? "Step 1 of 2 — Connect" : "Step 2 of 2 — Uplinks";
  }
  switch (step) {
    case "welcome":
      return "Welcome";
    case "setup":
      return "Step 2 of 4 — Connect";
    case "results":
      return "Step 3 of 4 — Uplinks";
    case "done":
      return "Step 4 of 4 — Done";
  }
}

export interface UplinkHubWizardProps {
  /**
   * True only when opened via the first-run auto-open host
   * (`UplinkHubWizardHost`): adds the Welcome/Done bookend steps (design §1)
   * that Task C explicitly scoped out. The persistent Settings-tab entry
   * point (default, `false`) is unchanged from Task C's shipped behaviour —
   * always setup -> results.
   */
  firstRun?: boolean;
  /**
   * Called when the operator finishes the first-run flow (the Done step's
   * Close button). Lets the host close the enclosing modal. Ignored unless
   * `firstRun` is true — the persistent entry point has no "finish" concept,
   * the operator just closes Settings themselves.
   */
  onFinish?: () => void;
}

/**
 * The Uplink Hub setup wizard
 * (`docs/superpowers/specs/2026-07-18-uplink-hub-wizard-design.md` §1-3).
 * Task C built the setup-assist step (reusing `SitrepConnection`) and the
 * results/load step (`useUplinkGap` + `loadUplinkById`); this task adds the
 * `firstRun` bookends (Welcome/Done) driven by the first-run auto-open host.
 *
 * Composed for embedding inside an existing modal (the Settings modal's
 * "Uplink Hub" tab) rather than opening a dialog of its own — no dialog
 * chrome here, just a step heading, the step body, and a nav footer.
 */
export function UplinkHubWizard({
  firstRun = false,
  onFinish,
}: UplinkHubWizardProps = {}) {
  const [step, setStep] = useState<WizardStep>(firstRun ? "welcome" : "setup");

  function handleBack() {
    if (step === "results") setStep("setup");
    else if (step === "setup" && firstRun) setStep("welcome");
  }

  function handleNext() {
    if (step === "welcome") setStep("setup");
    else if (step === "setup") setStep("results");
    else if (step === "results") setStep("done");
  }

  const showBack = step === "results" || (step === "setup" && firstRun);
  const showNext = step === "welcome" || step === "setup";
  const showFinish = step === "results" && firstRun;

  return (
    <Stack gap="md">
      <Intro>
        Checks what your Gonogo mod reports and offers to load any Uplink client
        that isn't downloaded yet.
      </Intro>
      <StepHeading aria-live="polite">{stepLabel(step, firstRun)}</StepHeading>
      {step === "welcome" && <WelcomeStep />}
      {step === "setup" && <SetupAssistStep />}
      {step === "results" && <ResultsStep />}
      {step === "done" && <DoneStep />}
      <Nav>
        {showBack && (
          <GhostButton type="button" onClick={handleBack}>
            Back
          </GhostButton>
        )}
        {showNext && (
          <PrimaryButton type="button" onClick={handleNext}>
            {step === "welcome" ? "Get Started" : "Next: Check Uplinks"}
          </PrimaryButton>
        )}
        {showFinish && (
          <PrimaryButton type="button" onClick={handleNext}>
            Finish
          </PrimaryButton>
        )}
        {step === "done" && (
          <PrimaryButton type="button" onClick={() => onFinish?.()}>
            Close
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
