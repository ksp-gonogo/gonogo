/** Where a station's credential stands: approved under an id and a name, or not. */
export type ApprovalLookup =
  | { approved: true; stationId: string; name: string }
  | { approved: false };

const NOT_APPROVED: ApprovalLookup = { approved: false };

/**
 * The record of which remote stations the host has approved, keyed by the
 * credential each station sends only to the host.
 *
 * A lookup answers at once when the answer is already known, and otherwise
 * with a promise, so a host serves a station it has seen before without a
 * round trip.
 */
export interface ApprovalBook {
  lookup(credential: string): ApprovalLookup | Promise<ApprovalLookup>;
  /** Approve a station, or rename one already approved. */
  approve(credential: string, name: string): unknown;
  revoke(stationId: string): unknown;
  /** Calls `cb` when an approval lands from somewhere other than this host. Returns the release. */
  onChange?(cb: () => void): () => void;
}

/** Approves nothing: what a host has before the game's record is attached. */
export const NO_APPROVALS: ApprovalBook = {
  lookup: () => NOT_APPROVED,
  approve: () => {},
  revoke: () => {},
};

/** The slice of the host role the game's record is reached through. */
export interface HostRecordCommands {
  checkStation(
    credential: string,
  ): Promise<
    { approved: boolean; stationId: string; name: string } | undefined
  >;
  approveStation(credential: string, name: string): Promise<boolean>;
  revokeStation(stationId: string): Promise<boolean>;
}

/**
 * The approvals the game mod keeps, asked for through the host role. The mod
 * publishes only an id per station, never its credential, so each credential is
 * checked with the mod once and the answer kept for this host's life.
 */
export class ModApprovalBook implements ApprovalBook {
  private readonly known = new Map<string, ApprovalLookup>();

  constructor(private readonly role: HostRecordCommands) {}

  lookup(credential: string): ApprovalLookup | Promise<ApprovalLookup> {
    const known = this.known.get(credential);
    if (known) return known;
    return this.role.checkStation(credential).then((answer) => {
      const lookup: ApprovalLookup = answer?.approved
        ? { approved: true, stationId: answer.stationId, name: answer.name }
        : NOT_APPROVED;
      if (answer) this.known.set(credential, lookup);
      return lookup;
    });
  }

  async approve(credential: string, name: string): Promise<void> {
    if (!(await this.role.approveStation(credential, name))) return;
    this.known.delete(credential);
    await this.lookup(credential);
  }

  async revoke(stationId: string): Promise<void> {
    for (const [credential, lookup] of this.known) {
      if (lookup.approved && lookup.stationId === stationId) {
        this.known.set(credential, NOT_APPROVED);
      }
    }
    await this.role.revokeStation(stationId);
  }
}
