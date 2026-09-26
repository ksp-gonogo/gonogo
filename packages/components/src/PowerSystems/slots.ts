/** What this widget is currently looking at, published for every augment bound to its slots. Read with `useWidgetScope("power-systems")`. */
export interface PowerSystemsScope {
  /** The resource the operator has focused, so an augment need not assume ElectricCharge. */
  resource: string;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    // Mounted by `Panel`'s universal `sections` segment; declared so a binder types against the propless contract.
    "power-systems.sections": Record<string, never>;
  }

  interface WidgetScopeRegistry {
    "power-systems": PowerSystemsScope;
  }
}
