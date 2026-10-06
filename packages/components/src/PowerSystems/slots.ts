/** What this widget is currently looking at, published for every augment bound to its slots. Read with `useWidgetScope("power-systems")`. */
export interface PowerSystemsScope {
  /** The resource the operator has focused, so an augment need not assume ElectricCharge. */
  resource: string;
}
