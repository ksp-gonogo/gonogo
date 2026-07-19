/**
 * Bundled-script payload forwarded to `executeScript` so the kOS data
 * source can keep the on-volume copy of `script` in sync with the bundled
 * body — see `dataSource/kosWrapper.ts`'s `buildKosWrapper`.
 */
export interface KosManagedScript {
  /** Full bundled script body. */
  body: string;
  /** Stable hash of `body`; mismatch with the on-volume sidecar triggers a rewrite. */
  version: string;
}
