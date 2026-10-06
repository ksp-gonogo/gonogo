import type { UplinkAlarmRequest } from "../api/alarm-request";
import type { UplinkClientHandle } from "../api/types";

/**
 * An alarm a widget asked for through `useAlarmRequest` under a test host,
 * recorded instead of created, so a test can check the request. Read them with
 * {@link getRequestedAlarms}.
 *
 * @category Test doubles
 */
export interface RecordedAlarmRequest extends UplinkAlarmRequest {
  /** The id off the handle the widget passed to `useAlarmRequest`. */
  uplinkId: string;
}

const recorded: RecordedAlarmRequest[] = [];

/**
 * Every alarm requested since the last clear, in the order they were asked for.
 *
 * @category Test doubles
 */
export function getRequestedAlarms(): readonly RecordedAlarmRequest[] {
  return [...recorded];
}

/**
 * Forgets every recorded request. Call it between tests.
 *
 * @category Test doubles
 */
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
