#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.propulsion</c> channel payload: the active vessel's mass and
/// thrust, the inputs to thrust-to-weight and burn-time figures. Mass is in
/// tonnes and thrust in kN, so <c>thrust / (mass · g)</c> is a
/// thrust-to-weight ratio directly.
/// <para>TWR, maximum TWR and a vessel-level burn-time estimate are derived by
/// the client from these fields, and are not streamed here.</para>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.propulsion")]
public class VesselPropulsion
{
    /// <summary>The vessel's total mass including resources, in tonnes (KSP's <c>Vessel.totalMass</c>).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double TotalMass { get; set; }

    /// <summary>The vessel's mass without resources, in tonnes: the sum of every part's <c>Part.mass</c>.</summary>
    [SitrepUnit(Units.Tonnes)]
    public double DryMass { get; set; }

    /// <summary>The thrust every engine on the vessel is producing now, in kN (the sum of <c>ModuleEngines.finalThrust</c>). Zero when nothing is firing.</summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double CurrentThrust { get; set; }

    /// <summary>
    /// The thrust the vessel can produce right now, in kN: the maximum thrust
    /// (<c>ModuleEngines.GetMaxThrust</c>) of every engine that is ignited and
    /// not flamed out. A shut-down or flamed-out engine contributes nothing, so
    /// this is not the vessel's rated maximum.
    /// </summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double AvailableThrust { get; set; }

    /// <summary>
    /// UT the craft's CURRENT continuous period of thrust began, or null when
    /// it is not under thrust as of the last measurable reading.
    ///
    /// <para><b>An observation instant.</b> It says when something was SEEN to
    /// be true, which is a different kind of UT from a plan's
    /// <c>ManeuverNode.Ut</c> or an orbit's <c>epoch</c>, and the <c>ut</c>
    /// token does not separate them. Subtracting this from a planned instant is
    /// type-legal and meaningless; the only duration it belongs in is one
    /// measured against the reader's own view clock.</para>
    ///
    /// <para>Latched rather than sent as an edge: every vessel channel is
    /// <c>Delivery.LossyLatest</c>, so a one-shot "thrust just started" event
    /// could be dropped, and a consumer that missed it could not tell that from
    /// nothing having happened. A latched instant is on every subsequent frame
    /// until it changes.</para>
    ///
    /// <para>Held, not cleared, while thrust is unmeasurable (an on-rails or
    /// packed craft has no parts to read). Otherwise switching away from a
    /// burning craft would read as its engines quitting.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ThrustStartedUt { get; set; }

    /// <summary>
    /// UT the craft's most recent period of thrust ENDED, or null when no
    /// period of thrust has been observed to end since this craft became the
    /// subject. Same observation-instant reading as
    /// <see cref="ThrustStartedUt"/>.
    ///
    /// <para><b>Present here with a null <see cref="ThrustStartedUt"/> is the
    /// fact nothing else on the wire can state:</b> the engines ran, and they
    /// have stopped. <see cref="CurrentThrust"/> at zero cannot say it (a craft
    /// that never lit reads the same), and <c>vessel.control.throttle</c>
    /// certainly cannot: that is where the pilot left the lever, and it sits at
    /// full through a flameout, a dry tank and an unlit stage.</para>
    ///
    /// <para>It does NOT say why the engines stopped, and no reading can. A
    /// burn paused to be re-planned and a burn abandoned produce the same
    /// instant, because the difference between them is whether the operator
    /// comes back, which has not happened yet. A consumer may report that
    /// thrust ceased with delta-v owed; it may not report a shortfall.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LastThrustEndUt { get; set; }

    /// <summary>Payload provenance. <c>Source</c> is <c>"vessel:&lt;guid&gt;"</c> for the active vessel; <c>Quality</c> is <c>Loaded</c> under physics and <c>OnRails</c> otherwise.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
