using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>How the game holds a craft that is not the active one.</summary>
    public enum CraftBand
    {
        /// <summary>Loaded and flying with full physics, within a few hundred metres of the active craft.</summary>
        Unpacked,

        /// <summary>Loaded beside the active craft but moved on rails: its parts are live, its motion is its orbit.</summary>
        Packed,

        /// <summary>Not loaded: the game holds its orbit and its saved snapshot.</summary>
        OnRails,
    }

    /// <summary>
    /// Every choice about what a craft that is not the active one reports into its
    /// lane, and how often: one place to change each. Read by the game-side lane
    /// feed for every craft it reads.
    /// </summary>
    public sealed class CraftLanePolicy
    {
        /// <summary>The policy in force.</summary>
        public static CraftLanePolicy Current { get; set; } = new CraftLanePolicy();

        /// <summary>UT between two readings of one loaded craft.</summary>
        public double LoadedIntervalUt { get; set; } = 2.0;

        /// <summary>The shortest UT between two readings of one craft on rails.</summary>
        public double OnRailsIntervalUt { get; set; } = 30.0;

        /// <summary>
        /// UT of each lane's history kept beyond the longest delay to it, so a screen
        /// that comes back to a craft is handed the readings it missed while it
        /// watched another. A screen away longer than this gets the span this covers.
        /// </summary>
        public double HistoryUt { get; set; } = 3600.0;

        /// <summary>UT of a craft's history handed to a screen the first time it is shown that craft.</summary>
        public double FirstViewHistoryUt { get; set; } = 300.0;

        /// <summary>The most loaded craft read each pass, nearest first.</summary>
        public int MaxLoadedCraft { get; set; } = 8;

        /// <summary>The vessel types, by the game's own names, that get no lane: nobody switches to one to read its gauges.</summary>
        public ISet<string> UnreportedVesselTypes { get; } =
            new HashSet<string>(StringComparer.Ordinal) { "Debris", "SpaceObject", "Flag", "Unknown" };

        /*
         * Groups of the vessel entry left out per band, by the entry's own keys. Empty
         * by default: the vessel walk already omits every group read off the parts of a
         * craft that is not loaded, so what is left is what the game holds.
         */
        private readonly Dictionary<CraftBand, HashSet<string>> _withheld = new Dictionary<CraftBand, HashSet<string>>
        {
            [CraftBand.Unpacked] = new HashSet<string>(StringComparer.Ordinal),
            [CraftBand.Packed] = new HashSet<string>(StringComparer.Ordinal),
            [CraftBand.OnRails] = new HashSet<string>(StringComparer.Ordinal),
        };

        /// <summary>Whether a craft of the game's vessel type <paramref name="vesselType"/> gets a lane.</summary>
        public bool Reports(string vesselType) => !UnreportedVesselTypes.Contains(vesselType);

        /// <summary>Leaves the vessel-entry group <paramref name="group"/> out of every lane reading of a craft in <paramref name="band"/>.</summary>
        public CraftLanePolicy Withhold(CraftBand band, string group)
        {
            _withheld[band].Add(group);
            return this;
        }

        /// <summary>Whether a craft in <paramref name="band"/> reports the vessel-entry group <paramref name="group"/>.</summary>
        public bool Keeps(CraftBand band, string group) => !_withheld[band].Contains(group);

        /// <summary>Whether a craft in <paramref name="band"/> also keeps its saved tanks, as the game last wrote them (a mod that simulates unloaded craft writes its results into the same snapshot).</summary>
        public bool HoldsSavedTanks(CraftBand band) => band == CraftBand.OnRails;

        /// <summary>
        /// <paramref name="entry"/> with every group a craft in <paramref name="band"/>
        /// does not report taken out. The entry passed in is left as it was.
        /// </summary>
        public Dictionary<string, object?> Filter(CraftBand band, IReadOnlyDictionary<string, object?> entry)
        {
            var kept = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var group in entry)
            {
                if (Keeps(band, group.Key))
                {
                    kept[group.Key] = group.Value;
                }
            }
            return kept;
        }
    }
}
