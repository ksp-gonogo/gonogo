#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.structure</c> channel payload — the other half of KspHost's
/// <c>misc</c> junk-drawer split (see <see cref="VesselCrew"/>'s doc
/// comment). <see cref="CurrentStage"/> uses KSP's own (P-4-flagged
/// "inverted vs. visible staging") numbering UNCHANGED — documented here,
/// not silently renumbered, so this contract doesn't invent a second
/// numbering scheme to reconcile. <see cref="StageCount"/> is already
/// <c>maxInverseStage + 1</c> (KspHost's own normalization). A future
/// part-tree/topology channel (<c>vessel.parts</c>) is a SIBLING of this
/// record, not a growth of it (R-8's "bulk topology is its own ASSET-class
/// design" lesson).
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselStructure
{
    /// <summary>KSP's own <c>Vessel.currentStage</c> numbering (capsule/high stages have LOW numbers) — see the class doc comment.</summary>
    public int CurrentStage { get; set; }

    /// <summary>Null when the vessel has no parts this tick.</summary>
    public int? StageCount { get; set; }

    /// <summary>Null when the vessel has no parts this tick.</summary>
    public int? PartCount { get; set; }

    public Meta Meta { get; set; } = new();
}
