import { type Value, value } from "@ksp-gonogo/sitrep-sdk";

/**
 * When a command stops being able to reach the thing it is about.
 *
 * <p><b>The deadline is not the instant it targets.</b> A press leaves at the
 * operator's VIEW instant, and the view instant trails reality by one one-way
 * light time, because that is how long the reading on screen took to arrive.
 * The command then spends a second one-way light time in flight. So a command
 * composed against what is on screen lands two one-way delays later, and the
 * last view instant it can leave from is `target - 2 * oneWay`.</p>
 *
 * <p>At a thirty-light-minute vantage that is a full HOUR before the countdown
 * on the row reaches zero, and for that hour every control reads as live, the
 * press is accepted, and the write arrives after the moment has passed. The
 * operator believes they acted.</p>
 *
 * <p>Shared rather than computed per surface. The burn editor and the plan
 * composer both have to answer it, and two implementations of the same
 * arithmetic would be free to disagree about the one thing an operator is
 * relying on them for.</p>
 */
export interface CommandWindow {
  /** One-way light time to this vessel, in seconds. */
  oneWaySeconds: number;
  /** The last view instant a command can leave from. */
  deadlineUt: number;
  /** How long the window has left. Negative once it has shut. */
  remainingSeconds: number;
  /** True once a command sent now would arrive after the instant it targets. */
  shut: boolean;
}

/**
 * Null at a vantage with no delay, where the deadline IS the target instant and
 * the countdown already on the row says so. A second countdown reading the same
 * number would be furniture, and a widget that showed one would train the
 * operator to ignore it at the vantages where the two differ by an hour.
 *
 * <p>Measured against the instant the command WOULD WRITE rather than the one
 * currently aboard: an operator who pushes a burn further out reopens the
 * window, and one who drags it into the past shuts it. That is the same
 * comparison the mod makes on arrival, so the prediction here and the refusal
 * there cannot disagree about what they are testing.</p>
 */
/**
 * How much of the window a seeded burn leaves the operator to work in.
 *
 * <p>Ten minutes. A seed is what an operator who does not retype the instant
 * actually sends, so it has to sit far enough past the round trip that finishing
 * the burn does not close the window that was open when they started, and near
 * enough that it reads as "shortly" rather than as a number somebody invented.
 * It is also the gap seeded between one burn and the next: two burns at one
 * instant are not in time order, and the mod refuses a plan whose burns are
 * not.</p>
 */
export const COMPOSING_MARGIN_SECONDS = 600;

/**
 * The instant to seed a burn at: after `previousUt` when there is one, and past
 * the round trip either way.
 *
 * <p><b>The bar is ARRIVAL, not the view.</b> The mod refuses any burn igniting
 * at or before the instant the plan lands, and a plan composed here lands two
 * one-way light times after the view instant it was composed at. Seeding a burn
 * at the instant the state was OBSERVED, which is what a composer with no window
 * arithmetic reaches for, puts every burn behind that bar the moment it is
 * created: the plan is offered, sent, and refused whole, and nothing on the way
 * says so.</p>
 */
export function seededIgnitionUt(
  previous: Value<"ut"> | null,
  viewUt: Value<"ut">,
  oneWaySeconds: number,
): Value<"ut"> {
  const flyable = viewUt.plus(
    value("s", 2 * Math.max(oneWaySeconds, 0) + COMPOSING_MARGIN_SECONDS),
  );
  if (previous === null) return flyable;
  // Whichever is later. A burn seeded after one the operator has already dragged
  // past the window keeps the order; a burn after one dragged into the past is
  // still flyable rather than inheriting the problem.
  const after = previous.plus(value("s", COMPOSING_MARGIN_SECONDS));
  return after.greaterThan(flyable) ? after : flyable;
}

export function commandWindow(
  targetUt: number | null,
  viewUt: number | null,
  oneWaySeconds: number,
): CommandWindow | null {
  if (targetUt === null || viewUt === null || oneWaySeconds <= 0) return null;
  const deadlineUt = targetUt - 2 * oneWaySeconds;
  const remainingSeconds = deadlineUt - viewUt;
  return {
    oneWaySeconds,
    deadlineUt,
    remainingSeconds,
    shut: remainingSeconds <= 0,
  };
}
