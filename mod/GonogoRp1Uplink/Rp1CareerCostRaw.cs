using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// One tick's reading of what the editor vehicle would cost to fly, in funds.
    /// Plain data, so the mapper is unit-testable with no game at all.
    /// </summary>
    public sealed class Rp1BuildCostRaw
    {
        public double Ut;

        /// <summary>
        /// The vehicle itself, and it ALREADY CONTAINS
        /// <see cref="UntooledSurcharge"/>: the surcharge reaches the vessel
        /// through IPartCostModifier and is folded into each part's cost before
        /// this is read. Adding the two would double-count.
        /// </summary>
        public double? VehicleCost;

        public double? UntooledSurcharge;
        public double? ToolingCost;
        public double? UnlockCost;

        /// <summary>Absent for a spaceplane: RP-1 computes a rollout only in the VAB.</summary>
        public double? RolloutCost;

        public List<string>? RequiredTechs;
    }

    /// <summary>One tick's reading of RP-1's career event log.</summary>
    public sealed class Rp1CareerEventsRaw
    {
        public double Ut;

        /// <summary>
        /// Whether RP-1 is keeping the log. FALSE is not an empty log: a career
        /// with logging off has no history and never will, which is a different
        /// answer from one that has recorded nothing yet.
        /// </summary>
        public bool? Enabled;

        public List<Rp1CareerEventRaw> Events = new List<Rp1CareerEventRaw>();
    }

    /// <summary>One dated thing RP-1 recorded, from any of its six lists.</summary>
    public sealed class Rp1CareerEventRaw
    {
        public double? Ut;
        public string? Kind;
        public string? Name;
        public string? Detail;

        /// <summary>Shared by a launch and the failures that happened on it.</summary>
        public string? LaunchId;

        public string? Part;
        public double? RepChange;
        public double? Cost;
    }
}
