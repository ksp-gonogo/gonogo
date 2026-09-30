#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.structure</c> channel payload: the active vessel's stage
/// and part counts. Absent when there is no active vessel.
///
/// <para><see cref="CurrentStage"/> uses KSP's own staging numbering
/// unchanged, which runs inverted relative to the staging list as drawn: this
/// contract does not renumber it. The part tree itself is on
/// <c>vessel.parts</c>.</para>
/// <internal>
/// The other half of KspHost's <c>misc</c> group split (see
/// <see cref="VesselCrew"/>).
/// </internal>
/// </summary>
/// <category>Vessel</category>
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

    /// <summary>Number of stages: the highest <c>Part.inverseStage</c> on the
    /// vessel plus one. Null when the vessel has no parts this tick.</summary>
    [SitrepUnit(Units.Count)]
    public int? StageCount { get; set; }

    /// <summary>Number of parts on the vessel. Null when the vessel's part
    /// list could not be read this tick.</summary>
    [SitrepUnit(Units.Count)]
    public int? PartCount { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
