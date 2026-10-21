import {
  describeInputBinding,
  type SerialDeviceService,
} from "@ksp-gonogo/serial";
import type { MissionProfilesService } from "./MissionProfilesService";
import type { ProfileDashboard } from "./ProfileDashboard";

/**
 * What `InputDispatcher` needs to switch layouts on an input press: the
 * layouts to watch, and what to do when one of their inputs is pressed. The
 * switch is an ordinary one, so Undo reverses it; pressing the input of the
 * layout already current does nothing.
 */
export function profileInputOptions(
  profiles: MissionProfilesService,
  dashboard: ProfileDashboard,
  serial: SerialDeviceService,
) {
  return {
    getProfileBindings: () => profiles.list(),
    onProfileInput: (profileId: string, deviceId: string, inputId: string) => {
      dashboard.switchTo(profileId, {
        kind: "input",
        inputLabel: describeInputBinding(serial, { deviceId, inputId }),
      });
    },
  };
}
