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
 *
 * `vessel.control` is read ONCE and serves both jobs: it carries the named
 * custom groups the registry derives from AND every stock singleton's value, so
 * the common case costs exactly one subscription. `Stage` is the sole group
 * whose value lives elsewhere (`vessel.structure.currentStage`, since it is a
 * staging command rather than a control input), so it branches to a sibling
 * that adds that second subscription only for the instance that needs it,
 * rather than every ActionGroup on the dashboard paying for it.
 */
function ActionGroupComponent(
  props: Readonly<ComponentProps<ActionGroupConfig>>,
) {
  const controlReading = useTelemetry("vessel.control");
  /**
   * Two currencies off ONE read, because this record carries both kinds of
   * field.
   *
   * WHICH action groups the vessel has is a fact. The named list changes when
   * the vessel does, and a link that has stopped delivering cannot have carried
   * that event, so the last list received is still the answer. Withholding it
   * would retire a control the operator is plainly still looking at, and worse:
   * an AGX group resolved from nothing degrades to a read-only pill under its
   * configured name, so blanking the registry would quietly take the toggle
   * away rather than mark it uncertain.
   */
  const group = useActionGroupFrom(
    stillTrue(controlReading, undefined),
    props.config?.actionGroupId,
  );

  // Index before name: only the stock singleton, which carries no index, reads its value off `vessel.structure`.
  if (group && group.index === undefined && group.name === "Stage") {
    return <StageActionGroup {...props} group={group} />;
  }
  /**
   * Whether that group is ON is a judgement, so it goes the other way. The pill
   * is a two-state verdict about the vessel now (an operator reads "ON" as the
   * gear being down, not as the gear having been down), and the same value is
   * inverted to build the toggle's absolute-set args. A held boolean would both
   * misstate the craft and command the wrong way.
   *
   * "Not current" means "the pill has nothing in it", which the view spends on
   * a reason line and on disabling the toggle. `vessel.control` declares no
   * reckonable value, so the observation is the only thing that ever fills the
   * pill and a held reading is exactly the empty case.
   */
  const valueNotCurrent = controlReading.state === "stale";
  const observed =
    controlReading.state === "observed" ? controlReading.value : undefined;
  const value = resolveGroupValue(group, observed);
  /**
   * A current payload that still cannot say whether this group is engaged.
   * `ActionGroupState.state` is three-valued for exactly this: a backend that
   * reads each group separately (AGX does, through reflection) can fail on one
   * group while the rest answer, and the whole-tick null on `actionGroups`
   * cannot express that. The same holds for a stock singleton whose typed field
   * arrived empty.
   *
   * A group the backend never reported at all is deliberately NOT this case: it
   * is `provenance: "assumed"`, the registry invented it out of the saved
   * config, and it has its own reason line downstream. Including it here would
   * take those cases off that line and explain them with the wrong sentence.
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
      valueNotCurrent={valueNotCurrent}
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
  /**
   * The current stage is a fact, unlike every other group's state. It moves
   * only when something stages, so it cannot drift while nobody is looking, and
   * the stage command is unconditional (`buildToggleArgs` returns `null` for
   * Stage and never inverts), so no command rides on this number being current.
   */
  return (
    <ActionGroupView
      {...props}
      group={group}
      value={stillTrue(structure, undefined)?.currentStage}
      valueNotCurrent={false}
      // Stage reads a NUMBER off another topic, so the three-valued action-group state this flag reports on does not reach it.
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
  // Compact controls pair nicely two-per-row on mobile.
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
