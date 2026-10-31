import type { ApprovalBook, ApprovalLookup } from "../peer/approvalBook";
import { setDefaultApprovalsForTests } from "../peer/hostDefaults";
import { getStationCredential } from "../peer/stationPeerId";

const NAME = "Test station";

/**
 * Approvals kept in memory and answered at once, standing in for the game's
 * record in a test that drives a host with no game behind it.
 */
export class MemoryApprovalBook implements ApprovalBook {
  private readonly approved = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  lookup(credential: string): ApprovalLookup {
    const name = this.approved.get(credential);
    return name === undefined
      ? { approved: false }
      : { approved: true, stationId: `id-${credential}`, name };
  }

  approve(credential: string, name: string): void {
    this.approved.set(credential, name);
    for (const cb of [...this.listeners]) cb();
  }

  revoke(stationId: string): void {
    for (const credential of [...this.approved.keys()]) {
      if (`id-${credential}` === stationId) this.approved.delete(credential);
    }
  }

  /** Every approved station, as a host's list would show it. */
  list(): { stationId: string; name: string }[] {
    return [...this.approved].map(([credential, name]) => ({
      stationId: `id-${credential}`,
      name,
    }));
  }
}

/*
 * Installed as the file's default as soon as this module loads, so a host a
 * test starts before it approves anything already reads it.
 */
const book = new MemoryApprovalBook();
setDefaultApprovalsForTests(book);

/** The approvals every host in this test file uses until one is attached. */
export function testApprovals(): MemoryApprovalBook {
  return book;
}

/**
 * Approve this process's station, as the main screen's operator would. Host
 * and station share one `localStorage` in a test process, so the station's
 * own credential is the one approved, and the approval holds whether the
 * station connects before or after.
 */
export function approveStation(): void {
  testApprovals().approve(getStationCredential(), NAME);
}

/** Introduce a host-side connection, driven directly by a test, as an approved station. */
export function approveConnection(
  conn: { emit(event: string, ...args: unknown[]): void },
  credential = "test-credential",
): void {
  testApprovals().approve(credential, NAME);
  conn.emit("data", { type: "station-credential", credential });
}
