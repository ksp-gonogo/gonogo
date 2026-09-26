export interface Strategy {
  id: string;
  title: string;
  description: string;
  departmentName: string;
  isActive: boolean;
  factor: number;
  dateActivated: number;
  requiredReputation: number;
  initialCostFunds: number;
  initialCostScience: number;
  initialCostReputation: number;
  /** Reputation cost after KSP's nonlinear rep curve; what the player actually loses. */
  effectiveCostReputation: number;
  hasFactorSlider: boolean;
  factorSliderDefault: number;
  factorSliderSteps: number;
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
