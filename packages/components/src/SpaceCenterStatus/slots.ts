/** `space-center-status.sections` appends extra facility-level rows to the body. */
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "space-center-status.sections": Record<string, never>;
  }
}

// An import-free file is a script, and a script's `declare module` replaces the package instead of augmenting it.
export {};
