import { Countdown, NULL_DISPLAY, Text } from "@ksp-gonogo/ui-kit";
import type { ControlDescription } from "./signalVerdict";
import { CAPTION_LABEL_STYLE, TONE_TEXT_COLOR } from "./tones";

/** Control state / signal delay rows, shared by the landscape and portrait grids. */
export function CommSignalDetailRows({
  control,
  delay,
  noSignal,
}: {
  control: ControlDescription;
  delay: Parameters<typeof Countdown>[0]["value"];
  /** Withholds the control row, which is read off the held `vessel.comms`. */
  noSignal?: boolean;
}) {
  return (
    <>
      <Text tone="muted" size="xs" style={CAPTION_LABEL_STYLE}>
        Control
      </Text>
      <Text
        tone="default"
        size="sm"
        style={{
          color: noSignal ? undefined : TONE_TEXT_COLOR[control.tone],
        }}
      >
        {noSignal ? NULL_DISPLAY : control.label}
      </Text>
      <Text tone="muted" size="xs" style={CAPTION_LABEL_STYLE}>
        Delay
      </Text>
      <Text tone="default" size="sm">
        {delay == null ? NULL_DISPLAY : <Countdown value={delay} precise />}
      </Text>
    </>
  );
}
