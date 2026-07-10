#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.identity</c> channel payload — kills V-13 (one typed
/// <see cref="Situation"/> enum replaces the v.situation/v.situationString/
/// v.landedAt triplet) and moves <c>missionTime</c> off the wire entirely:
/// <see cref="LaunchUt"/> is static after liftoff (sampleUt - missionTime),
/// so MET (mission elapsed time) is a consumer-side derivation
/// (viewUt - launchUt) rather than a tick-rate field that would force this
/// whole record to re-emit every tick — see
/// local_docs/telemetry-mod/m1-provider-taxonomy-design.md §0.2.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.identity")]
public class VesselIdentity
{
    /// <summary>The stable subject id (KSP's <c>Vessel.id</c> GUID, as a string) — the currency of target/vessel-scoped commands (T-1 groundwork) and of <c>Meta.Source</c>'s "vessel:&lt;guid&gt;" provenance stamp.</summary>
    public string VesselId { get; set; } = "";

    public string Name { get; set; } = "";

    public VesselType VesselType { get; set; }

    public Situation Situation { get; set; }

    /// <summary>Index into the <c>system.bodies</c> collection; null when the vessel has no orbit driver yet (e.g. a just-spawned EVA before it attaches).</summary>
    public int? ParentBodyIndex { get; set; }

    /// <summary>sampleUt - missionTime; null before the vessel's launch clock has started. See the class doc comment.</summary>
    public double? LaunchUt { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
