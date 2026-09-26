import { value } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";
import type { PlanResult } from "./planning";
import {
  FeasibilityBanner,
  FeasibilityBannerBody,
  FeasibilityBannerTitle,
} from "./styles";

interface ShortfallBannerProps {
  feasible: boolean | null;
  plan: PlanResult;
  requiredDeltaV: number;
  /** Vessel-total ΔV in m/s off the shared budget, `null` when there is no usable figure. */
  availableDeltaV: number | null;
}

export function ShortfallBanner({
  feasible,
  plan,
  requiredDeltaV,
  availableDeltaV,
}: ShortfallBannerProps) {
  const available = availableDeltaV;
  // The null check only narrows for the compiler: the planner judges feasibility only against a real figure.
  if (feasible !== false || !plan || available === null) return null;
  return (
    <FeasibilityBanner role="status" aria-live="polite">
      <FeasibilityBannerTitle>
        ΔV shortfall: can't add node
      </FeasibilityBannerTitle>
      <FeasibilityBannerBody>
        Required <Unit value={value("m/s", requiredDeltaV)} decimals={0} /> ·
        available <Unit value={value("m/s", available)} decimals={0} /> ·{" "}
        <Unit value={value("m/s", requiredDeltaV - available)} decimals={0} />{" "}
        short.
      </FeasibilityBannerBody>
    </FeasibilityBanner>
  );
}
