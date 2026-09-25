using Upgradeables;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// What a facility upgrade needs of the KSC's own <c>UpgradeableFacility</c>
    /// component, and the one upgrade path that leaves every event fired.
    ///
    /// <para><c>SetLevel</c> fires <c>OnKSCFacilityUpgrading</c>, then
    /// <c>UpgradeableObject.setLevel</c> despawns the old model, persists the tier,
    /// spawns the new model and fires <c>OnUpgradeableObjLevelChange</c>, all
    /// unconditionally. Only then does it return early when
    /// <c>gameObject.activeInHierarchy</c> is false, skipping a coroutine whose
    /// sole remaining job is to fire <c>OnKSCFacilityUpgraded</c>. So an inactive
    /// component (a KSC out of range of a craft in flight is deactivated, not
    /// destroyed) takes the whole upgrade and drops one notification.
    /// <see cref="Upgrade"/> fires that notification itself in exactly that case,
    /// rather than refusing an upgrade the game carries out correctly.</para>
    ///
    /// <para><c>FacilityLivenessTests</c> reads this class's IL and
    /// <c>SetLevel</c>'s out of the installed build and fails if the two stop
    /// agreeing on when the finishing event is skipped.</para>
    /// </summary>
    internal static class FacilityLiveness
    {
        /// <summary>
        /// Whether the component exists at all: Unity's null overload, so a
        /// destroyed component reads as absent. Absent, there is no price to read
        /// and no model to swap, and the upgrade is refused.
        /// </summary>
        public static bool IsBuilt(UpgradeableFacility? facility) => facility != null;

        /// <summary>
        /// Whether <c>SetLevel</c> goes on to fire <c>OnKSCFacilityUpgraded</c>
        /// itself: the guard it tests after raising the tier. Non-null first,
        /// because <c>gameObject</c> throws on a destroyed component.
        /// </summary>
        public static bool SetLevelFinishes(UpgradeableFacility? facility) =>
            facility != null && facility.gameObject.activeInHierarchy;

        /// <summary>
        /// Raises <paramref name="facility"/> to <paramref name="level"/> and fires
        /// <c>OnKSCFacilityUpgraded</c> when <c>SetLevel</c> did not. Asked after
        /// <c>SetLevel</c>, where the game asks it.
        /// </summary>
        public static void Upgrade(UpgradeableFacility facility, int level)
        {
            facility.SetLevel(level);
            if (!SetLevelFinishes(facility))
            {
                GameEvents.OnKSCFacilityUpgraded.Fire(facility, level);
            }
        }
    }
}
