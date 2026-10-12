import type { UplinkAlarmRequest } from "../api/alarm-request";
import type { UplinkClientHandle } from "../api/types";

/**
 * An alarm a widget asked for through `useAlarmRequest` under a test host,
 * recorded instead of created, so a test can check the request. Read them with
 * {@link getRequestedAlarms}. Useful for testing that pressing a widget's alarm
 * control asks for the alarm the operator expects.
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
 * Useful for testing that pressing a widget's alarm control asks for the alarm
 * the operator expects.
 *
 * @example
 * ```ts
 * import { clearRequestedAlarms, getRequestedAlarms } from "@ksp-gonogo/sitrep-sdk/testing";
 * import { afterEach, expect, it } from "vitest";
 *
 * afterEach(clearRequestedAlarms);
 *
 * it("asks for one alarm", () => {
 *   // ...render the widget and press its button, then:
 *   expect(getRequestedAlarms()).toHaveLength(1);
 * });
 * ```
 *
 * @category Test doubles
 */
export function getRequestedAlarms(): readonly RecordedAlarmRequest[] {
  return [...recorded];
}

/**
 * Forgets every recorded request. Call it between tests. Useful for starting
 * each test of a widget's alarm control with no requests recorded.
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
