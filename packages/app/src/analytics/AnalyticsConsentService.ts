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

export type ConsentValue = "enabled" | "disabled";

type Listener = (value: ConsentValue | undefined) => void;

export class AnalyticsConsentService {
  private readonly storage: Storage | undefined;
  private listeners = new Set<Listener>();

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

  /** Persist a choice and notify subscribers. No-op (no fire) if the value
   *  is unchanged so reactive consumers don't churn. */
  set(value: ConsentValue): void {
    if (this.get() === value) return;
    try {
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
