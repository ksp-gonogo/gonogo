#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.structure</c> channel payload: the other half of KspHost's
/// <c>misc</c> junk-drawer split (see <see cref="VesselCrew"/>'s doc
/// comment). <see cref="CurrentStage"/> uses KSP's own (P-4-flagged
/// "inverted vs. visible staging") numbering UNCHANGED: documented here,
/// not silently renumbered, so this contract doesn't invent a second
/// numbering scheme to reconcile. <see cref="StageCount"/> is already
/// <c>maxInverseStage + 1</c> (KspHost's own normalization). A future
/// part-tree/topology channel (<c>vessel.parts</c>) is a SIBLING of this
/// record, not a growth of it (R-8's "bulk topology is its own ASSET-class
/// design" lesson).
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.structure")]
public class VesselStructure
{
    /// <summary>KSP's own <c>Vessel.currentStage</c> numbering (capsule/high stages have LOW numbers); see the class doc comment.</summary>
    [SitrepUnit(Units.Id)]
    public int CurrentStage { get; set; }

    /// <summary>Null when the vessel has no parts this tick.</summary>
    [SitrepUnit(Units.Count)]
    public int? StageCount { get; set; }

    /// <summary>Null when the vessel has no parts this tick.</summary>
    [SitrepUnit(Units.Count)]
    public int? PartCount { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
