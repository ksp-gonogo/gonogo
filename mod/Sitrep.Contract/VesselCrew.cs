#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.crew</c> channel payload — count-only for M1 (G-13: grows
/// to a full roster later WITHOUT a topic rename, per the design doc §2.2's
/// "misc junk drawer split"). Splitting this out of KspHost's <c>misc</c>
/// group into its own coherent, independently-growable channel is itself
/// part of the wart-fix — a future roster addition is additive to this
/// record, not a new topic.
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselCrew
{
    public int Count { get; set; }

    public Meta Meta { get; set; } = new();
}
