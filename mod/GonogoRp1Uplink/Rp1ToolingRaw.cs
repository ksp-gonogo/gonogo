using System.Collections.Generic;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// One tick's reading of RP-1's tooling for the ship on the editor's table, as
    /// plain self-contained data: no live RP-1 or KSP object anywhere in the graph,
    /// so the engine can carry it to the Courier thread and the mapper is
    /// unit-testable with no game at all.
    /// </summary>
    public sealed class Rp1ToolingRaw
    {
        public double Ut;

        /// <summary>
        /// RP-1's own deduplicated total for tooling everything untooled on this
        /// ship, off the field it caches it in.
        ///
        /// <para>NOT the sum of <see cref="Rp1ToolingPartRaw.ToolingCost"/> across
        /// the parts below, and the difference is the point: tooling one part can
        /// leave another free, so the sum overstates. Both travel because they
        /// answer different questions.</para>
        /// </summary>
        public double? ToolAllCost;

        public List<Rp1ToolingPartRaw> Parts = new List<Rp1ToolingPartRaw>();

        /// <summary>
        /// The funds breakdown for the same vehicle, read on the SAME walk.
        ///
        /// <para>Together rather than on a capture of its own because the untooled
        /// surcharge on it is the sum of the rows above: two walks could disagree
        /// about one vehicle within a tick, and a breakdown whose "of which" line
        /// does not match the rows beside it is worse than either alone.</para>
        /// </summary>
        public Rp1BuildCostRaw? BuildCost;
    }

    /// <summary>One tooling module on one part of the editor ship.</summary>
    public sealed class Rp1ToolingPartRaw
    {
        public string? PartTitle;
        public string? ToolingType;
        public string? ToolingTypeTitle;

        /// <summary>
        /// The tooling's parameters as RP-1 renders them, variable-length by
        /// construction. There is no uniform numeric accessor; see
        /// <see cref="Rp1ToolingReflection"/>'s header.
        /// </summary>
        public string? ParameterSummary;

        public bool? Tooled;
        public double? ToolingCost;
        public double? UntooledSurcharge;

        /// <summary>The part's craft id, which is how a refit addresses it.</summary>
        public string? PartId;

        /// <summary>
        /// How many OTHER parts a refit of this one would silently take with it.
        /// RP-1 reports this after the fact; carried here so it can be said first.
        /// </summary>
        public int? SymmetryCounterparts;

        /// <summary>Whether a refit could reshape this part at all.</summary>
        public bool? Refittable;

        /// <summary>
        /// The sizes this part could be refitted TO, already filtered to ones it
        /// can use. Empty when the career owns none it could move to; null when
        /// the question does not apply, which is a tooled part, a part nothing can
        /// reshape, or a tooling type RP-1 offers no refit for.
        /// </summary>
        public List<Rp1ToolingRefitTargetRaw>? RefitTargets;
    }

    /// <summary>One owned tooling a part could be reshaped to fit.</summary>
    public sealed class Rp1ToolingRefitTargetRaw
    {
        public double Diameter;
        public double Length;

        /// <summary>
        /// The tank material RP-1's own picker chose for this row, which is what
        /// makes the row offerable at all: null means the part cannot use any
        /// material the tooling covers, and the row is dropped rather than
        /// published.
        /// </summary>
        public string? RfType;
    }
}
