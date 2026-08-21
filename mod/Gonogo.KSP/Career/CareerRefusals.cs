using Sitrep.Contract;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// The career limits KSP keeps, as the comparison a refusal carries.
    ///
    /// <para>Carved out of <see cref="KspCareerActuator"/> so the RULE can be
    /// entered by a test at all: the actuator's own bodies reach
    /// <c>Funding.Instance</c>, <c>ScenarioUpgradeableFacilities.Instance</c> and
    /// <c>ContractSystem.Instance</c>, every one a <c>MonoBehaviour</c> whose
    /// <c>Instance</c> is null outside a live scene, so a headless process cannot
    /// run a single line of them. Same discipline as <c>PlanOwner</c> and
    /// <c>CommNetOcclusion</c>, and the same reason.</para>
    ///
    /// <para>Every method takes numbers the caller has already read off the game
    /// and returns the <see cref="LimitBreach"/> to refuse with, or null to
    /// proceed. It names no authority itself; the caller names the
    /// <c>GameVariables</c> method it read the limit from.</para>
    /// </summary>
    public static class CareerRefusals
    {
        /// <summary>
        /// KSP's "no limit" sentinel, mapped to the absence of a limit.
        ///
        /// <para><c>GameVariables</c> returns <c>float.MaxValue</c> (and
        /// <c>int.MaxValue</c>) at top tier to mean unlimited.
        /// <see cref="LimitBreach.Limit"/> says plainly that it is never the
        /// sentinel: 3.4e38 rendered beside a craft mass is not "unlimited", it
        /// is a bug that reads as a units error. Returns null for the sentinel,
        /// which also makes a breach against an unlimited facility unreachable,
        /// since nothing can exceed a limit that is not there.</para>
        /// </summary>
        public static double? RealLimit(double limit)
        {
            if (double.IsNaN(limit) || double.IsInfinity(limit)) return null;
            // float.MaxValue arrives here widened to double, and int.MaxValue
            // exactly. Anything at or above the float sentinel is the sentinel:
            // no real career limit is within thirty orders of magnitude of it.
            if (limit >= float.MaxValue) return null;
            if (limit >= int.MaxValue) return null;
            return limit;
        }

        /// <summary>
        /// The Astronaut Complex's active-crew cap
        /// (<c>GameVariables.GetActiveCrewLimit</c>), which a hire would push
        /// past.
        /// </summary>
        public static LimitBreach? CrewCapBreach(
            string facilityId,
            string facilityName,
            double facilityLevel,
            int activeCrew,
            double crewLimit)
        {
            var limit = RealLimit(crewLimit);
            if (limit == null || activeCrew < limit.Value) return null;
            return new LimitBreach
            {
                Facility = facilityId,
                FacilityName = facilityName,
                FacilityLevel = facilityLevel,
                Quantity = "activeCrew",
                Limit = limit,
                Actual = activeCrew,
                Unit = Units.Count,
            };
        }

        /// <summary>
        /// A facility that has nothing above it
        /// (<c>UpgradeableFacility.FacilityLevel</c> against <c>MaxLevel</c>).
        ///
        /// <para>Tiers are 0-based internally and 1-based to an operator, who
        /// reads "tier 3 of 3" off the same building the game labels "Level 3".
        /// Both sides are shifted here so the pair stays consistent rather than
        /// one of them being off by one.</para>
        /// </summary>
        public static LimitBreach? MaxTierBreach(
            string facilityId,
            string facilityName,
            double facilityLevel,
            int level,
            int maxLevel)
        {
            if (level < maxLevel) return null;
            return new LimitBreach
            {
                Facility = facilityId,
                FacilityName = facilityName,
                FacilityLevel = facilityLevel,
                Quantity = "tier",
                Limit = maxLevel + 1,
                Actual = level + 1,
                Unit = Units.Count,
            };
        }

        /// <summary>
        /// A price against the balance that has to cover it.
        ///
        /// <para><see cref="LimitBreach.Limit"/> is the balance and
        /// <see cref="LimitBreach.Actual"/> is the price, which is the right way
        /// round for the comparison a breach models: what the call asked for
        /// against what was allowed.</para>
        /// </summary>
        public static LimitBreach ShortfallBreach(
            string facilityId,
            string facilityName,
            double facilityLevel,
            string quantity,
            double price,
            double balance,
            string unit)
        {
            return new LimitBreach
            {
                Facility = facilityId,
                FacilityName = facilityName,
                FacilityLevel = facilityLevel,
                Quantity = quantity,
                Limit = balance,
                Actual = price,
                Unit = unit,
            };
        }
    }
}
