using Upgradeables;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// Whether a facility's tier can be changed to completion: the question
    /// <c>UpgradeableFacility.SetLevel</c> itself asks, and no other.
    ///
    /// <para><c>SetLevel</c> fires <c>OnKSCFacilityUpgrading</c> and raises the
    /// tier unconditionally, then returns before the coroutine that fires
    /// <c>OnKSCFacilityUpgraded</c> whenever <c>gameObject.activeInHierarchy</c>
    /// is false. So a component that exists but is inactive takes an upgrade in
    /// half: the tier moves, the opening event fires, and every listener waiting
    /// on the finished upgrade (RP-1's construction queue among them) holds the
    /// opening half of a pair forever. Testing for a component that is merely
    /// not destroyed lets exactly that through.</para>
    ///
    /// <para><c>FacilityLivenessTests</c> reads both this method's IL and
    /// <c>SetLevel</c>'s out of the installed build and fails if they stop
    /// asking the same thing.</para>
    /// </summary>
    internal static class FacilityLiveness
    {
        /// <summary>
        /// Non-null (Unity's overload, so not destroyed) AND active in the
        /// hierarchy, in that order: <c>gameObject</c> throws on a destroyed
        /// component.
        /// </summary>
        public static bool CanComplete(UpgradeableFacility? facility) =>
            facility != null && facility.gameObject.activeInHierarchy;
    }
}
