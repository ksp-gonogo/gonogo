import { Button, Stack } from "@ksp-gonogo/ui-kit";
import { useCallback, useRef, useState } from "react";
import styled from "styled-components";
import { type CopyKey, say } from "./copy";
import { LeaveGuardContext, type LeaveSave } from "./leaveGuard";
import { useHasSetupSettings } from "./setupSettings";
import { ConnectStep } from "./steps/ConnectStep";
import { ContainerStep } from "./steps/ContainerStep";
import { DoneStep } from "./steps/DoneStep";
import { HealthStep } from "./steps/HealthStep";
import { RecommendedStep } from "./steps/RecommendedStep";
import { UplinkReadinessStep } from "./steps/UplinkReadinessStep";
import { WelcomeStep } from "./steps/WelcomeStep";

export type SetupStep =
  | "welcome"
  | "container"
  | "connect"
  | "uplinks"
  | "recommended"
  | "health"
  | "done";

const ORDER: readonly SetupStep[] = [
  "welcome",
  "container",
  "connect",
  "uplinks",
  "recommended",
  "health",
  "done",
];

const HEADING = {
  welcome: "welcome.heading",
  container: "container.heading",
  connect: "connect.heading",
  uplinks: "uplinks.heading",
  recommended: "recommended.heading",
  health: "health.heading",
  done: "done.heading",
} as const satisfies Record<SetupStep, CopyKey>;

/**
 * The label on the button that leaves each step. The last one is "Finish"
 * rather than "Close" because the modal chrome already has a Close, and two
 * buttons of the same name in one dialog is a keyboard operator's problem.
 */
const ADVANCE_LABEL = {
  welcome: "welcome.advance",
  container: "container.advance",
  connect: "connect.advance",
  uplinks: "uplinks.advance",
  recommended: "recommended.advance",
  health: "health.advance",
  done: "done.advance",
} as const satisfies Record<SetupStep, CopyKey>;

export interface FirstRunSetupProps {
  /**
   * Called from the last step's Close button, so the host can close the modal
   * it mounted this in.
   */
  onFinish?: () => void;
  /** The step the flow opens on, for a story that shows one step. The app always opens on the first. */
  initialStep?: SetupStep;
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
export function FirstRunSetup({
  onFinish,
  initialStep = "welcome",
}: Readonly<FirstRunSetupProps> = {}) {
  const [step, setStep] = useState<SetupStep>(initialStep);
  // The recommended settings step is there while some setting is tagged for it, and stays while it is open.
  const hasRecommended = useHasSetupSettings();
  const order =
    hasRecommended || step === "recommended"
      ? ORDER
      : ORDER.filter((s) => s !== "recommended");
  const index = order.indexOf(step);
  const saves = useRef(new Set<LeaveSave>());
  const [leaving, setLeaving] = useState(false);
  const registerLeaveSave = useCallback((save: LeaveSave) => {
    saves.current.add(save);
    return () => {
      saves.current.delete(save);
    };
  }, []);

  /** Saves what the step holds unsaved, then moves, or stays where a save was refused. */
  async function leaveTo(next: SetupStep | undefined) {
    setLeaving(true);
    const saved = await Promise.all([...saves.current].map((save) => save()));
    setLeaving(false);
    if (!saved.every(Boolean)) return;
    if (next === undefined) onFinish?.();
    else setStep(next);
  }

  function advance() {
    void leaveTo(step === "done" ? undefined : order[index + 1]);
  }

  return (
    <LeaveGuardContext.Provider value={registerLeaveSave}>
      <Stack gap="related-comfortable">
        <StepHeading aria-live="polite">
          {say("shell.stepHeading", {
            index: index + 1,
            total: order.length,
            heading: say(HEADING[step]),
          })}
        </StepHeading>
        {step === "welcome" && <WelcomeStep />}
        {step === "container" && <ContainerStep />}
        {step === "connect" && <ConnectStep />}
        {step === "uplinks" && <UplinkReadinessStep />}
        {step === "recommended" && <RecommendedStep />}
        {step === "health" && <HealthStep />}
        {step === "done" && <DoneStep />}
        <Nav>
          {index > 0 && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => void leaveTo(order[index - 1])}
              disabled={leaving}
            >
              {say("shell.back")}
            </Button>
          )}
          <Button
            variant="primary"
            type="button"
            onClick={advance}
            disabled={leaving}
          >
            {say(
              step === "uplinks" && hasRecommended
                ? "uplinks.advanceToRecommended"
                : ADVANCE_LABEL[step],
            )}
          </Button>
        </Nav>
      </Stack>
    </LeaveGuardContext.Provider>
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
