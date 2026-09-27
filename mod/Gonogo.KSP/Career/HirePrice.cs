using Gonogo.KSP.Gates;
using Sitrep.Contract;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// The next recruit's price against the balance. The price rises with the
    /// active roster, not per applicant, so one answer holds for every applicant:
    /// the hire gate asks it before anyone presses and the hire asks it again.
    /// </summary>
    internal static class HirePrice
    {
        /// <summary>The shortfall, or null when the next recruit is affordable.</summary>
        public static LimitBreach? Shortfall(KerbalRoster roster, Funding funding)
        {
            var gameVariables = GameVariables.Instance;
            var complexNorm = gameVariables != null && ScenarioUpgradeableFacilities.Instance != null
                ? ScenarioUpgradeableFacilities.GetFacilityLevel(SpaceCenterFacility.AstronautComplex)
                : 0f;
            var cost = gameVariables != null ? gameVariables.GetRecruitHireCost(roster.GetActiveCrewCount()) : 0f;
            var query = CareerAffordability.Price(
                TransactionReasons.CrewRecruited, Currency.Funds, cost);
            if (CareerAffordability.CanAfford(query, Currency.Funds)) return null;
            return CareerRefusals.ShortfallBreach(
                SpaceCenterFacility.AstronautComplex.ToString(),
                FacilityGateHelp.DisplayName(SpaceCenterFacility.AstronautComplex),
                complexNorm, "funds",
                CareerAffordability.PriceOf(query, Currency.Funds),
                funding.Funds, Units.Funds);
        }
    }
}
