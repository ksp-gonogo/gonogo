// A comms Uplink contributes a per-antenna breakdown below the readout from its own Topics, so this widget stays backend-agnostic.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "comm-signal.sections": Record<string, never>;
  }
}

export {};
