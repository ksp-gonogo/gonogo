/** A figure the record did not carry is `null`, never zero: zero is a real price and a real factor. */
export interface Strategy {
  id: string;
  title: string;
  description: string;
  departmentName: string;
  isActive: boolean;
  factor: number | null;
  dateActivated: number | null;
  requiredReputation: number | null;
  initialCostFunds: number | null;
  initialCostScience: number | null;
  initialCostReputation: number | null;
  hasFactorSlider: boolean;
  factorSliderDefault: number | null;
  factorSliderSteps: number | null;
  /** Null when the question could not be put to the game at all, which is not a refusal. */
  canActivate: boolean | null;
  activateBlockedReason: string;
  /**
   * Who answered: `"screened"` is KSP's own check, `"derived"` is the same rules
   * applied one at a time while the Administration Building is shut, `"none"`
   * is nobody. The widget never arms on a derived verdict: a yes nobody
   * screened is not an answer.
   */
  activateVerdictSource: "screened" | "derived" | "none";
  canDeactivate: boolean;
  deactivateBlockedReason: string;
  effect: string;
}
