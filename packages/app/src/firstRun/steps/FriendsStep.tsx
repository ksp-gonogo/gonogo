import { useSetting } from "@ksp-gonogo/sitrep-sdk";
import { Stack, Text } from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import styled from "styled-components";
import {
  AUTO_PORT_FORWARD_SETTING,
  type PortForwardState,
  readPortForward,
} from "../../relay/autoPortForward";
import type { SetupCheck } from "../checks";
import { runs, say } from "../copy";
import { Prose, StepCheck } from "./StepParts";

type Choice = "local" | "auto" | "manual";

/** The one port, UDP and TCP, the relay takes friends on other networks on. */
const ENDPOINT_PORT = 47100;
const POLL_MS = 3_000;

/**
 * Asks whether friends will join from other networks, and how the relay's
 * port gets opened for them: by Gonogo asking the router (the "Automatic port
 * forwarding" setting), or by the player forwarding it. Choosing automatic
 * shows what the router answered.
 */
export function FriendsStep() {
  const [auto, setAuto] = useSetting<boolean>(AUTO_PORT_FORWARD_SETTING);
  const [choice, setChoice] = useState<Choice>(auto ? "auto" : "local");

  function choose(next: Choice) {
    setChoice(next);
    setAuto(next === "auto");
  }

  return (
    <Stack gap="related-comfortable">
      <Text level="muted" size="sm">
        {say("friends.question")}
      </Text>
      <Choices>
        <legend>{say("friends.legend")}</legend>
        {(["local", "auto", "manual"] as const).map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="friends-on-other-networks"
              value={option}
              checked={choice === option}
              onChange={() => choose(option)}
            />
            {say(`friends.choice.${option}`)}
          </label>
        ))}
      </Choices>
      {choice === "auto" && <ForwardStatus />}
      {choice === "manual" && <ManualForward />}
      {choice === "local" && (
        <Text level="muted" size="sm">
          {say("friends.local")}
        </Text>
      )}
    </Stack>
  );
}

function ManualForward() {
  return (
    <Text level="muted" size="sm">
      <Prose runs={runs("friends.manual", { port: ENDPOINT_PORT })} />
    </Text>
  );
}

/**
 * What the relay reports about the router forward, asked again every few
 * seconds while the step is open. A router that refused or did not answer
 * leaves the player the by-hand way, so its instructions follow.
 */
function ForwardStatus() {
  const [state, setState] = useState<PortForwardState | null | undefined>();
  useEffect(() => {
    let live = true;
    const read = () =>
      void readPortForward().then((next) => {
        if (live) setState(next);
      });
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const check = forwardCheck(state);
  return (
    <>
      <StepCheck check={check} />
      {check.state === "attention" && <ManualForward />}
    </>
  );
}

function forwardCheck(state: PortForwardState | null | undefined): SetupCheck {
  if (state === null) {
    return { state: "fail", text: say("friends.check.noRelay") };
  }
  const mapping = state?.mapping;
  if (!state?.enabled || !mapping || mapping.state === "checking") {
    return {
      state: "checking",
      text: say("friends.check.checking", { port: ENDPOINT_PORT }),
    };
  }
  if (mapping.state === "mapped") {
    return {
      state: "pass",
      text: say("friends.check.pass", { port: ENDPOINT_PORT }),
    };
  }
  return { state: "attention", text: mapping.message };
}

const Choices = styled.fieldset`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  margin: 0;
  padding: 0;
  border: none;
  font-size: var(--font-size-prose);
  color: var(--color-text-primary);

  legend {
    padding: 0;
    margin-bottom: var(--gap-related);
    font-weight: 700;
  }

  label {
    display: flex;
    align-items: center;
    gap: var(--gap-related);
    cursor: pointer;
  }

  input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;
