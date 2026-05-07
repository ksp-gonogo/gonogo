/// <reference types="vite/client" />

declare const __GONOGO_VERSION__: string;
declare const __GONOGO_BUILD_TIME__: string;

interface ImportMetaEnv {
  readonly VITE_AXIOM_TOKEN?: string;
  readonly VITE_AXIOM_DATASET?: string;
  readonly VITE_AXIOM_URL?: string;
  readonly VITE_AXIOM_ORG_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
