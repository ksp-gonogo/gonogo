/**
 * Host-owned technical-analytics consent.
 *
 * A single global value persisted in its own localStorage slot
 * (`gonogo.analytics.consent`): deliberately separate from the
 * `gonogo.settings` store so the privacy-critical bit can't be tangled up
 * with unrelated preference writes. Values:
 *
 *   - `"enabled"` : operator switched analytics on in Settings; ship
 *     technical logs to Axiom.
 *   - `"disabled"`: operator switched it back off.
 *   - `undefined` : never touched, which counts as off.
 *
 * Privacy-first: nothing reaches Axiom until this reads `"enabled"`. The
 * main screen owns this value; stations never read it (they follow the
 * host over PeerJS: see StationScreen).
 */

export const ANALYTICS_CONSENT_KEY = "gonogo.analytics.consent";

/** Where the current run's id is kept, so a reload of the main screen stays in the same run. */
export const ANALYTICS_RUN_KEY = "gonogo.analytics.runId";

/** A run id that sorts by when the run began and says nothing about who began it: `run-20261018T0912-k3x9`. */
export function mintRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "");
  const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `run-${stamp}-${suffix}`;
}

export type ConsentValue = "enabled" | "disabled";

type Listener = (value: ConsentValue | undefined) => void;

export class AnalyticsConsentService {
  private readonly storage: Storage | undefined;
  private listeners = new Set<Listener>();
  /** The run when storage cannot hold it (private mode), so the page still keeps one id. */
  private memoryRunId: string | undefined;

  constructor(storage: Storage | undefined = globalThis.localStorage) {
    this.storage = storage;
  }

  /** Current consent, or `undefined` when the operator has never set it. */
  get(): ConsentValue | undefined {
    try {
      const raw = this.storage?.getItem(ANALYTICS_CONSENT_KEY);
      return raw === "enabled" || raw === "disabled" ? raw : undefined;
    } catch {
      return undefined;
    }
  }

  /** True only when consent is explicitly `"enabled"`. The gate every
   *  Axiom install checks. */
  isEnabled(): boolean {
    return this.get() === "enabled";
  }

  /**
   * The id of the current analytics run, stamped on every log entry the main
   * screen, its stations and the relay send while analytics is on, so one
   * playtest's entries can be pulled together. A run begins when analytics is
   * switched on and ends when it is switched off; reloads keep it. Undefined
   * while analytics is off.
   */
  runId(): string | undefined {
    if (!this.isEnabled()) return undefined;
    let stored: string | null = null;
    try {
      stored = this.storage?.getItem(ANALYTICS_RUN_KEY) ?? null;
    } catch {
      stored = null;
    }
    if (stored) return stored;
    if (this.memoryRunId) return this.memoryRunId;
    const minted = mintRunId();
    this.memoryRunId = minted;
    try {
      this.storage?.setItem(ANALYTICS_RUN_KEY, minted);
    } catch {
      // the in-memory copy carries the run for this page
    }
    return minted;
  }

  /** Persist a choice and notify subscribers. No-op (no fire) if the value
   *  is unchanged so reactive consumers don't churn. Any change ends the
   *  current run, so switching analytics back on starts a new one. */
  set(value: ConsentValue): void {
    if (this.get() === value) return;
    this.memoryRunId = undefined;
    try {
      this.storage?.removeItem(ANALYTICS_RUN_KEY);
      this.storage?.setItem(ANALYTICS_CONSENT_KEY, value);
    } catch {
      // localStorage unavailable (private mode / SSR): keep the in-memory notification working so the session still reflects the choice.
    }
    for (const l of this.listeners) l(value);
  }

  /** Subscribe to consent changes. Does not fire on subscribe, callers
   *  read `get()` for the current value. Returns an unsubscribe. */
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

/** Shared singleton: the host's one source of truth for consent. */
export const analyticsConsentService = new AnalyticsConsentService();
