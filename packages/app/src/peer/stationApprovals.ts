/**
 * The stations this main screen has approved, remembered across sessions.
 *
 * Keyed by each station's credential, the secret it sends only to the host,
 * never by its `stationKey`: the key is embedded in the station's broker peer
 * id and carried on every Commcast message, so any peer holding the share code
 * can learn another station's key and present it as its own.
 */

const STORAGE_KEY = "gonogo.host.approvedStations";

/** One approved station, as Settings lists it. */
export interface ApprovedStation {
  credential: string;
  /** The name the station last reported. */
  name: string;
  /** When it was approved, in Unix milliseconds. */
  approvedAt: number;
}

const EMPTY: readonly ApprovedStation[] = [];

function isApprovedStation(value: unknown): value is ApprovedStation {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "credential") === "string" &&
    typeof Reflect.get(value, "name") === "string" &&
    typeof Reflect.get(value, "approvedAt") === "number"
  );
}

class StationApprovals {
  private readonly listeners = new Set<() => void>();
  private cachedRaw: string | null = null;
  private cached: readonly ApprovedStation[] = EMPTY;

  /** Every approved station, oldest approval first. Stable between writes. */
  list(): readonly ApprovedStation[] {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return EMPTY;
    }
    if (raw === this.cachedRaw) return this.cached;
    this.cachedRaw = raw;
    this.cached = EMPTY;
    if (raw === null) return this.cached;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) this.cached = parsed.filter(isApprovedStation);
    } catch {
      /* unreadable: nothing is approved */
    }
    return this.cached;
  }

  isApproved(credential: string): boolean {
    return this.list().some((s) => s.credential === credential);
  }

  /** Approve a station, or rename one already approved. */
  approve(credential: string, name: string): void {
    const all = this.list();
    if (!all.some((s) => s.credential === credential)) {
      this.write([...all, { credential, name, approvedAt: Date.now() }]);
      return;
    }
    this.write(
      all.map((s) => (s.credential === credential ? { ...s, name } : s)),
    );
  }

  remove(credential: string): void {
    this.write(this.list().filter((s) => s.credential !== credential));
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private write(next: readonly ApprovedStation[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota or private mode: nothing can be remembered */
    }
    for (const cb of this.listeners) cb();
  }
}

export const stationApprovals = new StationApprovals();
