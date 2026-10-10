import { value } from "@ksp-gonogo/sitrep-sdk";
import { Countdown, NULL_DISPLAY, Text, Unit } from "@ksp-gonogo/ui-kit";
import type { ControlDescription, QuantityReading } from "./signalVerdict";
import { CAPTION_LABEL_STYLE, TONE_TEXT_COLOR } from "./tones";

/** Control state / signal delay rows, shared by the landscape and portrait grids. */
export function CommSignalDetailRows({
  control,
  delay,
  noSignal,
  quantity,
}: {
  control: ControlDescription;
  delay: Parameters<typeof Countdown>[0]["value"];
  /** Withholds the control row, which is read off the held `vessel.comms`. */
  noSignal?: boolean;
  /** What the strength is a fraction of; the row is left out where nothing says. */
  quantity?: QuantityReading | null;
}) {
  return (
    <>
      {quantity != null && !noSignal && (
        <>
          <Text level="muted" size="xs" style={CAPTION_LABEL_STYLE}>
            Strength
          </Text>
          <Text size="sm">
            {quantity.percent !== null && (
              <>
                <Unit value={value("%", quantity.percent)} decimals={0} />{" "}
              </>
            )}
            {quantity.words}
          </Text>
        </>
      )}
      <Text level="muted" size="xs" style={CAPTION_LABEL_STYLE}>
        Control
      </Text>
      <Text
        size="sm"
        style={{
          color: noSignal ? undefined : TONE_TEXT_COLOR[control.tone],
        }}
      >
        {noSignal ? NULL_DISPLAY : control.label}
      </Text>
      <Text level="muted" size="xs" style={CAPTION_LABEL_STYLE}>
        Delay
      </Text>
      <Text size="sm">
        {delay == null ? NULL_DISPLAY : <Countdown value={delay} precise />}
      </Text>
    </>
  );
}
