import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  useSelectedVantage,
  useTelemetryClientOptional,
} from "@ksp-gonogo/sitrep-client";
import {
  Cluster,
  EmptyState,
  Panel,
  PanelTitle,
  ToggleButton,
} from "@ksp-gonogo/ui-kit";

type CommandSourcePickerConfig = Record<string, never>;

const actions = [
  {
    id: "cycle",
    label: "Cycle command source",
    accepts: ["button"],
  },
] as const satisfies readonly ActionDefinition[];

/**
 * The command centre this mission control commands from and observes at
 * (Plan 3): each active centre's own light-time defines the delay on every
 * downlink and command, so selecting one re-points the whole view (via
 * `client.setVantage`, which re-subscribes every active topic at the new
 * vantage's offset). One centre is always selected; the default is KSC. With
 * only KSC enumerated today it honestly lists KSC alone; it grows as Phase-2
 * centres come online.
 */
function CommandSourcePickerComponent(
  _props: Readonly<ComponentProps<CommandSourcePickerConfig>>,
) {
  const roster = useTelemetry("commandCentre.roster");
  const selected = useSelectedVantage();
  const client = useTelemetryClientOptional();

  const active = (roster ?? []).filter(
    (c): c is typeof c & { id: string } => c.active && c.id != null,
  );

  useActionInput<typeof actions>({
    // A physical selector (a knob/button) cycles to the next active centre.
    cycle: () => {
      if (active.length === 0) return;
      const i = active.findIndex((c) => c.id === selected);
      const next = active[(i + 1) % active.length];
      client?.setVantage(next.id);
    },
  });

  return (
    <Panel>
      <PanelTitle>Command Source</PanelTitle>
      {active.length === 0 ? (
        <EmptyState layout="fill" role="status" aria-live="polite">
          No command centres available.
        </EmptyState>
      ) : (
        <Cluster role="group" aria-label="Command centre vantage">
          {active.map((c) => {
            const isSelected = c.id === selected;
            return (
              <ToggleButton
                key={c.id}
                active={isSelected}
                tone="go"
                onClick={() => client?.setVantage(c.id)}
              >
                {c.displayName ?? c.id}
              </ToggleButton>
            );
          })}
        </Cluster>
      )}
    </Panel>
  );
}

registerComponent<CommandSourcePickerConfig>({
  id: "command-source-picker",
  name: "Command Source",
  description:
    "The command centre this mission control commands from and observes at (Plan 3): each active centre's own light-time defines the delay on every downlink and command. Selecting one re-points the whole view to that vantage. One centre is always selected (default KSC); with only KSC enumerated today it lists KSC alone, and grows as Phase-2 centres come online.",
  tags: ["control", "telemetry"],
  defaultSize: { w: 6, h: 3 },
  minSize: { w: 3, h: 2 },
  component: CommandSourcePickerComponent,
  dataRequirements: ["commandCentre.roster"],
  defaultConfig: {},
  actions,
});

export { CommandSourcePickerComponent };
