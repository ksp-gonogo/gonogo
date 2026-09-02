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

        public List<Rp1RequiredTechRaw>? RequiredTechs;
    }

    /// <summary>
    /// One unresearched node the editor vehicle needs: RP-1's id, KSP's title for
    /// it, and the parts on the ship waiting for it.
    /// </summary>
    public sealed class Rp1RequiredTechRaw
    {
        public string? Id;

        /// <summary>
        /// ABSENT where the tree has no title, never the id and never a blank:
        /// GetTechnologyTitle answers an unknown id with the empty string.
        /// </summary>
        public string? Title;

        /// <summary>
        /// NULL where the editor ship could not be read, EMPTY where it was read
        /// and nothing on it names this node. The two are different answers and a
        /// client renders them differently.
        /// </summary>
        public List<string>? Parts;
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

        public double? RepChange;
        public double? Cost;

        /// <summary>
        /// Whether a leader was HIRED or dismissed. A leader row without it is a
        /// name and a cost that read the same either way.
        /// </summary>
        public bool? IsAdd;

        /// <summary>Which editor a launch was built in, VAB or SPH.</summary>
        public string? BuiltAt;
    }
}
