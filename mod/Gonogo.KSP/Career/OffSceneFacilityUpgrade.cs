using System;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// A facility upgrade where no live <c>UpgradeableFacility</c> is registered:
    /// the persisted tier is written straight to the save's
    /// <c>ProtoUpgradeable.configNode</c>, which <c>UpgradeableFacility.Load</c>
    /// applies the next time the building spawns. This is the second arm of RP-1's
    /// <c>KCTUtilities.SetFacilityLevel</c>.
    ///
    /// <para><c>SetLevel</c> never runs here, so nothing fires its events or
    /// charges for it. The steps below are the live path's in the live path's
    /// order: one debit, then <c>OnKSCFacilityUpgrading</c>, the tier, and
    /// <c>OnKSCFacilityUpgraded</c>.</para>
    /// </summary>
    internal static class OffSceneFacilityUpgrade
    {
        public const string LevelKey = "lvl";

        public static void Apply(
            ConfigNode node,
            int newTier,
            int maxLevel,
            Action debit,
            Action<int> upgrading,
            Action<int> upgraded)
        {
            debit();
            upgrading(newTier);
            node.SetValue(LevelKey, FacilityLadder.NormFromTier(newTier, maxLevel), createIfNotFound: true);
            upgraded(newTier);
        }

        /// <summary>
        /// The tier the save holds for this facility, as the component will read it
        /// on its next load. No readable <c>lvl</c> is the top tier, as
        /// <c>ProtoUpgradeable.GetLevel</c> answers it.
        /// </summary>
        public static int PersistedTier(ConfigNode node, int maxLevel)
        {
            var raw = node.GetValue(LevelKey);
            if (string.IsNullOrEmpty(raw)
                || !float.TryParse(
                    raw,
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var norm))
            {
                return maxLevel;
            }
            return FacilityLadder.TierFromNorm(norm, maxLevel);
        }
    }
}
