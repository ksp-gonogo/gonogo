/**
 * Runtime carrier for the local app version. The actual constants live in
 * `packages/app/src/version.ts` (baked in by Vite); the app calls
 * `setAppVersion()` once at boot so packages outside @ksp-gonogo/app — most
 * notably the components library — can read it without a circular import.
 */

let appVersion: { version: string; buildTime: string } | null = null;

export function setAppVersion(version: string, buildTime: string): void {
  appVersion = { version, buildTime };
}

export function getAppVersion(): { version: string; buildTime: string } | null {
  return appVersion;
}
