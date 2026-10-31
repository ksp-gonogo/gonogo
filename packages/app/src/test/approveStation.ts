import { stationApprovals } from "../peer/stationApprovals";
import { getStationCredential } from "../peer/stationPeerId";

const NAME = "Test station";

/**
 * Approve this process's station, as the main screen's operator would. Host
 * and station share one `localStorage` in a test process, so the station's
 * own credential is the one approved, and the approval holds whether the
 * station connects before or after.
 */
export function approveStation(): void {
  stationApprovals.approve(getStationCredential(), NAME);
}

/** Introduce a host-side connection, driven directly by a test, as an approved station. */
export function approveConnection(
  conn: { emit(event: string, ...args: unknown[]): void },
  credential = "test-credential",
): void {
  stationApprovals.approve(credential, NAME);
  conn.emit("data", { type: "station-credential", credential });
}
