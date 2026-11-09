/**
 * What a control that is not given a `command` draws for a reason the game is
 * likely to refuse the command it sends. Spread the result onto the button: a
 * command that goes through within a few seconds is disabled with the reason as
 * its tip, and a command held longer stays pressable with a dashed warning edge
 * and the reason as its tip, since the game decides on arrival. Useful for a
 * plain button, slider or menu item that sends a command through its own
 * handler. Used by the flight controls that sit beside a command handle.
 *
 * @category CommandButton
 */
export interface PlainAdvice {
  /** True when the press should be stopped: the reason applies and the command goes through within a few seconds. */
  disabled: boolean;
  /** The reason, for a disabled control's tip; absent when there is no reason. */
  disabledReason: string | undefined;
  /** `at-risk` while the control is advised and still pressable; absent otherwise. */
  predictedOutcome: "at-risk" | undefined;
  /** The advice sentence for a pressable control's tip; absent when there is none or the control is disabled. */
  tip: string | undefined;
}

/**
 * Turns a predicted refusal into what a plain control draws: stopped when the
 * command goes through within a few seconds, advised when it is held longer.
 * `reason` is a lowercase clause such as "the vessel is not controllable", or
 * `null` when nothing says the game will refuse it. `handle` is the command
 * handle from `useCommand`, whose `gateStopsPress` says how fresh the
 * prediction is. Used by the flight controls that sit beside a command handle.
 *
 * @category CommandButton
 */
export function adviceFor(
  handle: { gateStopsPress?: boolean },
  reason: string | null | undefined,
): PlainAdvice {
  if (!reason) {
    return {
      disabled: false,
      disabledReason: undefined,
      predictedOutcome: undefined,
      tip: undefined,
    };
  }
  const sentence = `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`;
  return handle.gateStopsPress === true
    ? {
        disabled: true,
        disabledReason: sentence,
        predictedOutcome: undefined,
        tip: undefined,
      }
    : {
        disabled: false,
        disabledReason: undefined,
        predictedOutcome: "at-risk",
        tip: `Likely to be refused: ${reason}.`,
      };
}
