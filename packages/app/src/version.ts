// Baked in by Vite's `define` in vite.config.ts. The `typeof` guard keeps
// vitest happy when the file is loaded outside the Vite build.
export const VERSION: string =
  typeof __GONOGO_VERSION__ !== "undefined" ? __GONOGO_VERSION__ : "0.0.0";

export const BUILD_TIME: string =
  typeof __GONOGO_BUILD_TIME__ !== "undefined"
    ? __GONOGO_BUILD_TIME__
    : new Date().toISOString();

/** The publish channel this build is for, set by the publish step; a local build counts as the release. */
export const CHANNEL: "app" | "rc" =
  typeof __GONOGO_CHANNEL__ !== "undefined" && __GONOGO_CHANNEL__ === "rc"
    ? "rc"
    : "app";
