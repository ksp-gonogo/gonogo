using System;
using System.Collections.Generic;
using Upgradeables;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// A facility's tier ladder, remembered from the last live
    /// <c>UpgradeableFacility</c> seen for it, so a scene with no live component
    /// can still price and apply an upgrade.
    ///
    /// <para>Only SPACECENTER, EDITOR and FLIGHT register the KSC's components with
    /// <c>ScenarioUpgradeableFacilities</c>; TRACKSTATION leaves every
    /// <c>facilityRefs</c> empty. The save still carries the tier there, as the
    /// normalised <c>lvl</c> on <c>ProtoUpgradeable.configNode</c>, but the count
    /// that turns it back into a tier and the price of each rung live only on the
    /// component. Both are fixed for the install, and a loaded save always
    /// enters one of the three registering scenes before it can reach the
    /// Tracking Station, so the ladder read there is the one that applies
    /// here.</para>
    /// </summary>
    internal static class FacilityLadder
    {
        /// <summary>One facility's ladder: its top tier's index and the raw cost of each tier.</summary>
        internal sealed class Rungs
        {
            public Rungs(int maxLevel, float[] levelCosts, UpgradeableFacility? component)
            {
                MaxLevel = maxLevel;
                LevelCosts = levelCosts;
                Component = component;
            }

            /// <summary>The top tier's zero-based index, as <c>UpgradeableObject.MaxLevel</c>.</summary>
            public int MaxLevel { get; }

            /// <summary>Tier n's <c>levelCost</c>, before the career's funds multiplier.</summary>
            public float[] LevelCosts { get; }

            /// <summary>The component the ladder was read from, which Unity reads as null once destroyed.</summary>
            public UpgradeableFacility? Component { get; }
        }

        private static readonly object Gate = new object();
        private static readonly Dictionary<string, Rungs> Seen = new Dictionary<string, Rungs>(StringComparer.Ordinal);

        /// <summary>Records <paramref name="live"/>'s ladder under its sanitised facility id.</summary>
        public static void Remember(string sanitizedId, UpgradeableFacility live)
        {
            var levels = live.UpgradeLevels;
            if (levels == null) return;
            var costs = new float[levels.Length];
            for (var i = 0; i < levels.Length; i++) costs[i] = levels[i]?.levelCost ?? 0f;
            Remember(sanitizedId, new Rungs(live.MaxLevel, costs, live));
        }

        public static void Remember(string sanitizedId, Rungs rungs)
        {
            lock (Gate) Seen[sanitizedId] = rungs;
        }

        public static bool TryGet(string sanitizedId, out Rungs rungs)
        {
            lock (Gate) return Seen.TryGetValue(sanitizedId, out rungs!);
        }

        /// <summary>Forgets every ladder. For tests.</summary>
        internal static void Clear()
        {
            lock (Gate) Seen.Clear();
        }

        /// <summary>
        /// The tier a normalised level names, exactly as
        /// <c>UpgradeableFacility.setNormLevel</c> derives it when the component
        /// next loads.
        /// </summary>
        public static int TierFromNorm(float norm, int maxLevel)
        {
            if (float.IsNaN(norm)) norm = 0f;
            var clamped = Math.Max(0f, Math.Min(1f, norm));
            var tier = (int)Math.Floor(clamped * (maxLevel + 1));
            return Math.Max(0, Math.Min(maxLevel, tier));
        }

        /// <summary>
        /// The normalised level <c>UpgradeableFacility.Save</c> writes for a tier.
        /// A one-tier facility is at its top, as RP-1's own off-scene write has it.
        /// </summary>
        public static float NormFromTier(int tier, int maxLevel) =>
            maxLevel == 0 ? 1f : (float)tier / maxLevel;

        /// <summary>
        /// The raw cost of the tier above <paramref name="tier"/>, or null at the top
        /// or past the end of the ladder. <c>GetUpgradeCost</c> applies the career's
        /// funds multiplier to this.
        /// </summary>
        public static float? NextTierCost(Rungs rungs, int tier)
        {
            if (tier >= rungs.MaxLevel) return null;
            var next = tier + 1;
            if (next < 0 || next >= rungs.LevelCosts.Length) return null;
            return rungs.LevelCosts[next];
        }
    }
}
