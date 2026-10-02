import {
  registerAugment,
  registerBarePrimitiveTopic,
} from "@ksp-gonogo/sitrep-sdk";
import { useCommand, useStream } from "@ksp-gonogo/sitrep-sdk/spine";
import { Button, Section, Text } from "@ksp-gonogo/ui-kit";
import { PLANTED_UPLINK } from "./plantedUplink";

/**
 * A stand-in for an Uplink section that needs a part the save may not have
 * researched: a burn executor in the Maneuver Planner's sections slot. It
 * reads and commands through hooks in its own body and declares nothing about
 * tech, which is the point: the lock it shows comes from the channel's gate in
 * the fixture, not from anything written here.
 *
 * Requires its own Domain, so it renders only in a scene that emits
 * {@link PLANTED_LOCKS_AVAILABLE_TOPIC}.
 */
const PLANTED_LOCKS_DOMAIN = "planted-locks";

export const PLANTED_LOCKS_AVAILABLE_TOPIC = `${PLANTED_LOCKS_DOMAIN}.available`;

const EXECUTOR_TOPIC = `${PLANTED_LOCKS_DOMAIN}.executor`;

registerBarePrimitiveTopic(PLANTED_LOCKS_AVAILABLE_TOPIC);

function BurnExecutorSection() {
  const executor = useStream<{ cpu: string; script: string }>(EXECUTOR_TOPIC);
  const arm = useCommand(`${PLANTED_LOCKS_DOMAIN}.executor.arm`);
  const state =
    executor.state === "observed" || executor.state === "held"
      ? executor.value
      : undefined;
  return (
    <Section title="Burn executor">
      <Text>CPU {state?.cpu ?? "none"}</Text>
      <Text level="muted">Script {state?.script ?? "none"}</Text>
      <Button
        type="button"
        onClick={() => void arm.send({}, { label: "Arm executor" })}
      >
        Arm on next node
      </Button>
    </Section>
  );
}

registerAugment({
  id: "planted-locks:executor",
  augments: "maneuver-planner.sections",
  requires: PLANTED_LOCKS_DOMAIN,
  owner: PLANTED_UPLINK,
  label: "Burn executor",
  component: BurnExecutorSection,
});
