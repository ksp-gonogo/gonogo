declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    // An Uplink contributes a warp-target action alongside the widget's own warp buttons.
    "warp-control.stepper": Record<string, never>;
  }
}

export {};
