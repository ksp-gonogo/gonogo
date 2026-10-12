import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { formatDuration } from "./formatDuration";
import { HeldFigure } from "./HeldMark";
import { ModelledAlongside } from "./ModelledAlongside";
import { NULL_DISPLAY } from "./NullValue";
import {
  figureAttributes,
  modelledBeyondReceived,
  resolveCurrency,
} from "./readingCurrency";

/**
 * Props for {@link Countdown}.
 * Useful for giving the clock the duration it shows the operator. Used by
 * {@link Countdown}.
 *
 * @category MissionDate
 */
export interface CountdownProps {
  /**
   * A duration in seconds: how long until, or how long since. A client-computed
   * duration is made with `value("s", seconds)`.
   *
   * Not `Value<"ut">`: an instant is a type error here. Subtract the instant
   * the screen is showing, from `useViewUt`, to turn an instant into a
   * duration.
   */
  value: Value<"s"> | Reading<Value<"s">> | null | undefined;
  /**
   * Prefix the launch-clock sign: `T−` counting down to the event, `T+` once
   * it has passed. Off by default: a "how long until" readout is not a clock.
   */
  clock?: boolean;
  /**
   * Count the last second in milliseconds rather than showing `0s`, for a cue
   * the operator acts on, where `0s` for a whole second reads as stopped. Off by
   * default, where it would be false precision.
   */
  precise?: boolean;
}

/**
 * A duration drawn as a clock: `1m 20s`, or `T−1m 20s` on a launch clock.
 * Useful for showing the time left until an event. Used by
 * {@link InFlightList} for each command's arrival. A `Value<"s">` has three
 * renderers, chosen by what the value is:
 *
 * - {@link Unit} for a magnitude: a burn lasting 90 seconds
 * - `Countdown` for a clock, with the opt-in `T−` / `T+` prefix and
 *   sub-second precision for a cue that would otherwise sit at `0s`
 * - {@link MissionDate} for an instant: a UT is not a length of time
 *
 * Handed a `Reading`, a countdown draws the model's reckoning where there is
 * one, so it keeps advancing while a model carries it, and freezes on the last
 * observation, with the held mark, otherwise. {@link Unit} does this only when
 * given `reckoned`. A current reading whose model reaches past the newest data
 * received draws its observation, and the model's figure beside it with the
 * modelled mark. An absent value renders
 * {@link NULL_DISPLAY}.
 *
 * @category MissionDate
 */
export function Countdown({
  value,
  clock = false,
  precise = false,
}: CountdownProps) {
  const format = (duration: Value<"s">) =>
    formatDuration(duration.magnitude, { ms: precise, sign: clock });
  const reading = value != null && "state" in value ? value : undefined;
  const modelled = modelledBeyondReceived(reading);
  if (reading?.value !== undefined && modelled !== undefined) {
    return (
      <>
        {format(reading.value)}
        <ModelledAlongside
          observed={reading.value}
          modelled={modelled}
          write={format}
        />
      </>
    );
  }
  const currency = resolveCurrency(value, { drawsReckoning: true });
  const { shown, held, mark, caption } = currency;
  if (shown === undefined || shown === null) return NULL_DISPLAY;
  const text = format(shown);
  const figure = figureAttributes(currency);
  if (!held) return <span data-figure={figure["data-figure"]}>{text}</span>;
  return (
    <HeldFigure {...figure} kind={mark ?? "held"} caption={caption}>
      {text}
    </HeldFigure>
  );
}
