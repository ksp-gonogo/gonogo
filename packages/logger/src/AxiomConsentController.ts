import type { ConsoleLogger } from "./index.js";
import type { LogTransport } from "./types.js";

/**
 * Gates a single Axiom transport on the operator's technical-analytics
 * consent. Consent is opt-in and privacy-first: nothing reaches Axiom
 * until {@link apply}`(true)` is called, and revoking consent removes the
 * transport (flushing it first) so the next entry stays local.
 *
 * The Axiom token is the credential; consent is the additional runtime
 * gate. Without a token (`makeTransport` returns `null`) the controller
 * can never install anything — `apply(true)` is then a no-op. This keeps
 * dev/test/CI silent exactly as before unless a token is present AND the
 * operator has enabled analytics.
 *
 * One controller per logger per process. `apply` is idempotent: repeated
 * calls with the same effective state don't churn the transport, so it's
 * safe to wire straight onto a consent-change subscription.
 */
export class AxiomConsentController {
  private readonly logger: Pick<
    ConsoleLogger,
    "addTransport" | "removeTransport"
  >;
  /** Lazily constructs the Axiom transport. Returns `null` when no token
   *  is configured, so a tokenless build never installs a sink. Called at
   *  most once per install; the instance is reused until removed. */
  private readonly makeTransport: () => LogTransport | null;
  private installed: LogTransport | null = null;

  constructor(opts: {
    logger: Pick<ConsoleLogger, "addTransport" | "removeTransport">;
    makeTransport: () => LogTransport | null;
  }) {
    this.logger = opts.logger;
    this.makeTransport = opts.makeTransport;
  }

  /**
   * Bring the Axiom transport in line with `enabled`. Installs the
   * transport when consent is granted and a token is available; removes it
   * when consent is revoked. Idempotent.
   */
  apply(enabled: boolean): void {
    if (enabled) {
      if (this.installed) return;
      const transport = this.makeTransport();
      if (!transport) return; // no token — can't ship regardless of consent
      this.installed = transport;
      this.logger.addTransport(transport);
      return;
    }
    if (!this.installed) return;
    this.logger.removeTransport(this.installed);
    this.installed = null;
  }

  /** True when the Axiom transport is currently installed. Test helper. */
  isInstalled(): boolean {
    return this.installed !== null;
  }
}
