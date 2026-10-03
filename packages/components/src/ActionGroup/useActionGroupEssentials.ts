import type { ComponentProps } from "@ksp-gonogo/core";
import { useActionGroupFrom, useTelemetry } from "@ksp-gonogo/core";
import { stillTrue, type TinyEssential } from "@ksp-gonogo/sitrep-sdk";
import { useStatusContribution } from "@ksp-gonogo/ui-kit";
import type { ActionGroupConfig } from "./config";
import { groupStateOf } from "./groupState";
import { HELD_STATE } from "./toggleAvailability";
import { useGroupToggle } from "./useGroupToggle";

/**
 * The group's name over its toggle, bound to the same command and inputs as the
 * full body. A Stage tile reads `vessel.structure` here whatever the group, since
 * a hook cannot subscribe conditionally the way the body's Stage leg does.
 */
export function useActionGroupEssentials(
  props: Readonly<ComponentProps<ActionGroupConfig>>,
): readonly TinyEssential[] {
  const controlReading = useTelemetry("vessel.control");
  const structure = useTelemetry("vessel.structure");
  const group = useActionGroupFrom(
    stillTrue(controlReading, undefined),
    props.config?.actionGroupId,
  );
  const isStage = group?.index === undefined && group?.name === "Stage";
  const state = groupStateOf(group, controlReading);
  const label = props.config?.label ?? group?.name ?? "";
  const toggle = useGroupToggle({
    group,
    ...(isStage
      ? {
          ...state,
          value: stillTrue(structure, undefined)?.currentStage,
          valueHeld: false,
          stateUnreadable: false,
        }
      : state),
    label,
  });
  // The tile has no room for the body's badge, so the reason rides the header's status dot.
  useStatusContribution(
    toggle.unavailableReason !== null && toggle.unavailableReason !== HELD_STATE
      ? {
          id: "unavailable",
          severity: "warn",
          label: toggle.unavailableReason,
        }
      : null,
  );
  if (!group) return [{ label: "ACTION GROUP", word: "NONE" }];
  return [
    {
      label,
      control: {
        label: toggle.stateLabel,
        active: toggle.isOn,
        disabled: !toggle.canToggle,
        title: `Toggle ${label}`,
        hint: toggle.unavailableReason ?? undefined,
        onPress: toggle.press,
      },
    },
  ];
}
