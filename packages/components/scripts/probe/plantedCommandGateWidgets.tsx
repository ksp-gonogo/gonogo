import { registerComponent } from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-sdk/spine";
import { Button, Panel, Section } from "@ksp-gonogo/ui-kit";
import { PLANTED_COMMAND_GATE_IDS } from "./plantedCommandGateWidgets.ids";

function CommandBody({ command, label }: { command: string; label: string }) {
  const handle = useCommand(command);
  return (
    <Panel
      panelTitle={label}
      sections={
        <Section full>
          <Button
            type="button"
            onClick={() =>
              void handle.dangerouslySendWithoutInput({}).catch(() => undefined)
            }
          >
            {label}
          </Button>
        </Section>
      }
    />
  );
}

/**
 * Reads only `comms.delay` and sends a command the mod addresses to the active
 * craft, declaring no commands of its own, the way an Uplink's command-only
 * widget does.
 */
registerComponent({
  id: PLANTED_COMMAND_GATE_IDS.craft,
  name: "Craft command",
  description: "A render harness plant: sends one command aimed at the craft.",
  tags: [],
  component: () => (
    <CommandBody command="planted-gate.craft" label="Craft command" />
  ),
  dataRequirements: ["comms.delay"],
  defaultSize: { w: 5, h: 5 },
  minSize: { w: 4, h: 4 },
});

/** Sends a command aimed at the ground establishment, which works with no vessel. */
registerComponent({
  id: PLANTED_COMMAND_GATE_IDS.ground,
  name: "Ground command",
  description: "A render harness plant: sends one command aimed at the ground.",
  tags: [],
  component: () => (
    <CommandBody command="planted-gate.ground" label="Ground command" />
  ),
  dataRequirements: ["comms.delay"],
  defaultSize: { w: 5, h: 5 },
  minSize: { w: 4, h: 4 },
});
