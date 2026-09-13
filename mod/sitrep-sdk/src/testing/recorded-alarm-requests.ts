import type { UplinkAlarmRequest } from "../api/alarm-request";
import type { UplinkClientHandle } from "../api/types";

/**
 * The test double behind `useAlarmRequest`: it records what was asked for
 * instead of creating anything.
 *
 * There is nothing for it to create. The alarm list belongs to the app, and
 * this package sits below it, which is the same reason the augment registry
 * arrives through `UiKitHostPieces` rather than being implemented here. What an
 * Uplink's own test needs is not a real alarm, it is the ability to assert that
 * pressing the button asked for the right one, so that is what this gives.
 */
export interface RecordedAlarmRequest extends UplinkAlarmRequest {
  /** The id off the handle the widget passed to `useAlarmRequest`. */
  uplinkId: string;
}

const recorded: RecordedAlarmRequest[] = [];

/** Every alarm requested since the last clear, in the order they were asked for. */
export function getRequestedAlarms(): readonly RecordedAlarmRequest[] {
  return [...recorded];
}

/** Forget every recorded request. Call it between tests. */
export function clearRequestedAlarms(): void {
  recorded.length = 0;
}

/** The `useAlarmRequest` member `installRealTestHost` wires. */
export function recordAlarmRequest(
  owner: UplinkClientHandle,
): (request: UplinkAlarmRequest) => void {
  return (request) => {
    recorded.push({ ...request, uplinkId: owner.id });
  };
}
