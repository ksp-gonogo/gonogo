import type { ActionDefinition } from "@ksp-gonogo/core";
import {
  describeInputBinding,
  type InputMappings,
  InputMappingTab,
  SerialDeviceProvider,
  useSerialDeviceService,
} from "@ksp-gonogo/serial";
import { Button, useModal } from "@ksp-gonogo/ui";
import { Cluster, Tooltip } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import { useMissionProfilesService } from "./MissionProfilesContext";
import type { MissionProfile } from "./MissionProfilesService";

const SWITCH_ACTION = {
  id: "switch",
  label: "Switch to this layout",
  accepts: ["button"],
  description: "Pressing this input makes this layout the current one",
} as const satisfies ActionDefinition;

interface ProfileInputSlotProps {
  profile: MissionProfile;
  /** Told what a binding did, in words, so the list can show it. */
  onNotice: (message: string) => void;
}

/**
 * The input that switches to one layout: what it is now, and a button that
 * opens the same input picker a widget's Inputs tab uses. An input already
 * switching to another layout moves to this one, and the notice says so.
 */
export function ProfileInputSlot({
  profile,
  onNotice,
}: Readonly<ProfileInputSlotProps>) {
  const svc = useMissionProfilesService();
  const serial = useSerialDeviceService();
  const { open, close } = useModal();

  const label = profile.inputBinding
    ? describeInputBinding(serial, profile.inputBinding)
    : null;

  const handleOpen = () => {
    const id = open(
      <SerialDeviceProvider service={serial}>
        <InputMappingTab
          actions={[SWITCH_ACTION]}
          mappings={{ switch: profile.inputBinding ?? null }}
          onSave={(next: InputMappings) => {
            const binding = next.switch ?? null;
            const { movedFrom } = svc.bindInput(profile.id, binding);
            close(id);
            if (!binding) return;
            const name = describeInputBinding(serial, binding);
            onNotice(
              movedFrom
                ? `${name} now switches to ${profile.name}, and no longer to ${movedFrom.name}`
                : `${name} now switches to ${profile.name}`,
            );
          }}
          onClose={() => close(id)}
        />
      </SerialDeviceProvider>,
      { title: `Input for ${profile.name}` },
    );
  };

  return (
    <Cluster justify="start" wrap>
      <Label>
        {label ? `Switch with: ${label}` : "No input switches to this layout"}
      </Label>
      <Tooltip text="Choose a key or controller button that switches to this layout">
        <Button
          variant="ghost"
          type="button"
          onClick={handleOpen}
          aria-label={`${label ? "Change" : "Set"} input for ${profile.name}`}
        >
          {label ? "Change input" : "Set input"}
        </Button>
      </Tooltip>
    </Cluster>
  );
}

const Label = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;
