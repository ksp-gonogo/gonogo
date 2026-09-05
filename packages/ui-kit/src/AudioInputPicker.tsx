import { useId } from "react";
import { Button } from "./Button";
import { Field, FieldHint, FieldLabel, Select } from "./Form";
import { Stack } from "./Stack";
import { StatusIndicator, type StatusTone } from "./StatusIndicator";
import {
  type AudioInputControls,
  type AudioInputState,
  describeAudioInput,
  type UseAudioInputOptions,
  useAudioInput,
} from "./useAudioInput";

export interface AudioInputPickerProps extends UseAudioInputOptions {
  /** Visible name for the device picker. Defaults to `Audio input`. */
  label?: string;
}

/**
 * Microphone access and device choice, as one control: it asks for permission,
 * lists what the browser will admit to, opens the chosen input and hands the
 * stream back through `onStream`.
 *
 * It knows nothing about what the stream is for. Push-to-talk radio is the
 * first caller and not the shape of the API: anything capturing audio asks the
 * same questions, and a second copy of the answers is how two surfaces come to
 * disagree about what a refusal means.
 *
 * <b>Every state it can be in is a distinguishable sentence.</b> An insecure
 * origin, a refused permission and an absent device all end with no stream, and
 * each has a different cause and a different remedy. Collapsing them into one
 * "microphone unavailable" line sends an operator on a LAN http station hunting
 * through browser permissions that were never the problem. The refusal copy in
 * particular states where the answer is held rather than offering another
 * press, because the browser returns the same answer without prompting for as
 * long as the site setting stands, and a button that cannot work is worse than
 * no button.
 */
export function AudioInputPicker({
  label = "Audio input",
  ...options
}: AudioInputPickerProps) {
  const input = useAudioInput(options);
  const selectId = useId();
  const unnamed = unnamedDevicesSentence(input);

  return (
    <Stack gap="sm">
      <StatusIndicator tone={stateTone(input.status)} live>
        {stateSentence(input)}
      </StatusIndicator>

      {input.status === "ready" && input.devices.length > 0 ? (
        <Field>
          <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
          <Select
            id={selectId}
            value={input.deviceId ?? ""}
            onChange={(event) => {
              void input.select(event.target.value);
            }}
          >
            {input.devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {describeAudioInput(device, index)}
              </option>
            ))}
          </Select>
          {input.failure ? (
            <FieldHint>
              {`The requested input did not open. The browser reported ${input.failure.name}, and the previous input is still running.`}
            </FieldHint>
          ) : null}
        </Field>
      ) : null}

      {canRequest(input.status) ? (
        <Button
          type="button"
          onClick={() => {
            void input.request();
          }}
          disabled={input.status === "requesting"}
          aria-busy={input.status === "requesting"}
        >
          Request microphone access
        </Button>
      ) : null}

      {unnamed ? <FieldHint>{unnamed}</FieldHint> : null}
    </Stack>
  );
}

function canRequest(status: AudioInputControls["status"]): boolean {
  return status === "unasked" || status === "requesting" || status === "failed";
}

const TONES: Record<AudioInputControls["status"], StatusTone> = {
  "insecure-origin": "warn",
  "no-media-devices": "nogo",
  unasked: "neutral",
  requesting: "info",
  refused: "nogo",
  "no-device": "warn",
  failed: "nogo",
  ready: "go",
};

function stateTone(status: AudioInputControls["status"]): StatusTone {
  return TONES[status];
}

/**
 * The one sentence describing where capture stands. `unasked` splits on
 * whether any label is populated, because a populated label is the browser's
 * own evidence that access was granted: the state after a release is not the
 * state before a first request, and saying access "has not been requested"
 * once it plainly has is the kind of small falsehood that costs trust in every
 * other reading on the screen.
 */
function stateSentence(state: AudioInputState): string {
  switch (state.status) {
    case "insecure-origin":
      return "This page is not a secure origin. Microphone capture is available on https pages and on localhost.";
    case "no-media-devices":
      return "This browser exposes no media device interface, so no input can be opened here.";
    case "unasked":
      return accessGranted(state)
        ? "Microphone access is granted for this origin. No input is open."
        : "Microphone access has not been requested for this origin.";
    case "requesting":
      return "A capture request is with the browser, which may be prompting for access.";
    case "refused":
      return "Microphone access was refused for this origin. The browser holds that answer in its site settings and returns it to any further request without prompting.";
    case "no-device":
      return "No audio input device is present.";
    case "failed":
      return `The input did not open. The browser reported ${state.failure?.name ?? "an unnamed error"}.`;
    case "ready":
      return `Capturing from ${openDeviceName(state)}.`;
  }
}

function accessGranted(state: AudioInputState): boolean {
  return state.devices.some((device) => device.label !== "");
}

function openDeviceName(state: AudioInputState): string {
  const index = state.devices.findIndex(
    (device) => device.deviceId === state.deviceId,
  );
  const device = index === -1 ? undefined : state.devices[index];
  return device ? describeAudioInput(device, index) : "an unnamed input";
}

/**
 * What is known about the devices while their names are not. Shown only before
 * access is granted, where a count is the whole of what the browser will say.
 */
function unnamedDevicesSentence(state: AudioInputState): string | null {
  if (state.status !== "unasked" || accessGranted(state)) return null;
  const count = state.devices.length;
  if (count === 0) return null;
  return count === 1
    ? "One audio input is visible. Its name is withheld by the browser until access is granted."
    : `${count} audio inputs are visible. Their names are withheld by the browser until access is granted.`;
}
