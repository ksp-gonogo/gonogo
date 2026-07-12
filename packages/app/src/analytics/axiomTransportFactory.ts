import {
  AxiomConsentController,
  AxiomTransport,
  logger,
} from "@ksp-gonogo/logger";

/**
 * Build the Axiom transport factory for the browser, reading the ingest
 * token + dataset baked in at build time. Returns `null` when no token is
 * present so a tokenless build (local dev, CI) can never install a sink —
 * the {@link AxiomConsentController} then treats `apply(true)` as a no-op.
 *
 * Token = credential, consent = runtime gate: both must hold before
 * anything ships to Axiom.
 */
export function makeBrowserAxiomTransport(): AxiomTransport | null {
  const token = import.meta.env.VITE_AXIOM_TOKEN;
  if (!token) return null;
  return new AxiomTransport({
    token,
    dataset: import.meta.env.VITE_AXIOM_DATASET ?? "gonogo",
    url: import.meta.env.VITE_AXIOM_URL,
    orgId: import.meta.env.VITE_AXIOM_ORG_ID,
  });
}

/**
 * Construct a consent controller bound to the app's shared logger and the
 * browser Axiom transport. Console + ring-buffer logging is untouched;
 * only the Axiom fan-out is gated. Default state is removed (disabled)
 * until {@link AxiomConsentController.apply}`(true)` is called.
 */
export function createBrowserConsentController(): AxiomConsentController {
  return new AxiomConsentController({
    logger,
    makeTransport: makeBrowserAxiomTransport,
  });
}
