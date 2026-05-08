/// <reference types="vite/client" />

declare const __GONOGO_VERSION__: string;
declare const __GONOGO_BUILD_TIME__: string;

interface ImportMetaEnv {
  readonly VITE_AXIOM_TOKEN?: string;
  readonly VITE_AXIOM_DATASET?: string;
  readonly VITE_AXIOM_URL?: string;
  readonly VITE_AXIOM_ORG_ID?: string;
  /**
   * Override for the URL the Add Station QR / link points at. Forks can
   * point this at their own deploy. When unset, the modal falls back to
   * the page origin for HTTPS deploys and to the canonical github.io
   * station URL for local-dev origins (localhost, LAN IP).
   */
  readonly VITE_STATION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
