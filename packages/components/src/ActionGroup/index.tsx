import type { ActionGroup, ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  resolveGroupValue,
  useActionGroupFrom,
  useTelemetry,
} from "@ksp-gonogo/core";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { ActionGroupConfigForm } from "./ActionGroupConfigForm";
import { ActionGroupView } from "./ActionGroupView";
import { type ActionGroupConfig, actionGroupActions } from "./config";
import "./slots";

export type { ActionGroupActions, ActionGroupConfig } from "./config";
export type { ActionGroupSlotContext } from "./slots";

/**
 * Resolves this instance's group and live value, then renders the view.
 * `vessel.control` carries both the group list and every stock value; only
 * `Stage` reads `vessel.structure`, so only a Stage instance subscribes to it.
 */
function ActionGroupComponent(
  props: Readonly<ComponentProps<ActionGroupConfig>>,
) {
  const controlReading = useTelemetry("vessel.control");
  // Which groups exist is a fact and stays held; blanking it would turn a toggle into a read-only pill.
  const group = useActionGroupFrom(
    stillTrue(controlReading, undefined),
    props.config?.actionGroupId,
  );

  // Index before name: only the stock singleton, which carries no index, reads its value off `vessel.structure`.
  if (group && group.index === undefined && group.name === "Stage") {
    return <StageActionGroup {...props} group={group} />;
  }
  // Whether a group is ON is never held: the toggle inverts it to build its args, so a held value would command the wrong way.
  const valueHeld = controlReading.state === "stale";
  const observed =
    controlReading.state === "observed" ? controlReading.value : undefined;
  const value = resolveGroupValue(group, observed);
  /**
   * A current payload that still cannot say whether this group is engaged. An
   * `assumed` group (never reported by the backend) is excluded: it has its own
   * reason line.
   */
  const stateUnreadable =
    observed !== undefined &&
    group !== undefined &&
    group.provenance !== "assumed" &&
    value == null;
  return (
    <ActionGroupView
      {...props}
      group={group}
      value={value}
      valueHeld={valueHeld}
      stateUnreadable={stateUnreadable}
    />
  );
}

/** The Stage-only leg: see {@link ActionGroupComponent}. */
function StageActionGroup({
  group,
  ...props
}: Readonly<ComponentProps<ActionGroupConfig>> & { group: ActionGroup }) {
  const structure = useTelemetry("vessel.structure");
  // The current stage is a fact and may be held: the stage command is unconditional, so nothing is built from it.
  return (
    <ActionGroupView
      {...props}
      group={group}
      value={stillTrue(structure, undefined)?.currentStage}
      valueHeld={false}
      stateUnreadable={false}
    />
  );
}

registerComponent<ActionGroupConfig>({
  id: "action-group",
  name: "Action Group",
  description:
    "Toggle a KSP action group or system (SAS, RCS, gear, brakes, lights, AG1-AG10).",
  tags: ["control", "telemetry"],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 3 },
  mobileWidth: "half",
  component: ActionGroupComponent,
  configComponent: ActionGroupConfigForm,
  dataRequirements: [],
  defaultConfig: { actionGroupId: "AG1" },
  actions: actionGroupActions,
  augmentSlots: ["action-group.subsystem"],
  requires: ["flight"],
});

export { ActionGroupComponent };
