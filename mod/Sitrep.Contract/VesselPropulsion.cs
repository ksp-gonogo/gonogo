#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.propulsion</c> Topic payload: the active vessel's mass and
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
    /// The propellant every running engine is drawing now, in kg/s: the sum of
    /// each ignited, unflamed engine's <c>ModuleEngines.requestedMassFlow</c>,
    /// scaled by the share of that request its tanks met
    /// (<c>propellantReqMet</c>). Zero when nothing is firing.
    ///
    /// <para>With <see cref="CurrentThrust"/> and <see cref="TotalMass"/> this
    /// is the whole of a burn's mass budget: the vessel's mass at a later
    /// instant is the mass now less this rate over the interval, so a burn can
    /// be carried forward with its rising acceleration rather than a constant
    /// one.</para>
    ///
    /// <para>Null when the engines cannot be read: an on-rails or packed craft
    /// has no running modules to sum, and a zero there would claim the engines
    /// are cold.</para>
    /// </summary>
    [SitrepUnit(Units.KilogramsPerSecond)]
    public double? MassFlow { get; set; }

    /// <summary>
    /// UT the craft's current continuous period of thrust began, or null when
    /// it is not under thrust as of the last measurable reading.
    ///
    /// <para><b>An observation instant.</b> It says when something was seen to
    /// be true, which is a different kind of UT from a plan's
    /// <c>ManeuverNode.Ut</c> or an orbit's <c>epoch</c>, although all three
    /// carry the same unit. Subtracting this from a planned instant compiles and
    /// means nothing; measure a duration from it only against the reader's own
    /// view clock.</para>
    ///
    /// <para>It is repeated on every frame until it changes, not sent once when
    /// thrust starts, so a client that missed a frame still sees it.</para>
    /// <internal>
    /// Latched rather than sent as an edge because every vessel channel is
    /// <c>Delivery.LossyLatest</c>: a one-shot event could be dropped, and a
    /// consumer that missed it could not tell that from nothing having happened.
    /// </internal>
    ///
    /// <para>Held, not cleared, while thrust is unmeasurable (an on-rails or
    /// packed craft has no parts to read). Otherwise switching away from a
    /// burning craft would read as its engines quitting.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ThrustStartedUt { get; set; }

    /// <summary>
    /// UT the craft's most recent period of thrust ended, or null when no
    /// period of thrust has been observed to end since this craft became the
    /// subject. Same observation-instant reading as
    /// <see cref="ThrustStartedUt"/>.
    ///
    /// <para>Set here with a null <see cref="ThrustStartedUt"/>, it says the
    /// engines ran and have stopped, which no other field can say.
    /// <see cref="CurrentThrust"/> at zero reads the same for a craft that never
    /// lit, and <c>vessel.control.throttle</c> is where the pilot left the
    /// lever, which stays at full through a flameout, a dry tank and an unlit
    /// stage.</para>
    ///
    /// <para>It does not say why the engines stopped, and no reading can. A
    /// burn paused to be re-planned and a burn abandoned produce the same
    /// instant, because the difference between them is whether the operator
    /// comes back, which has not happened yet. A consumer may report that
    /// thrust ceased with delta-v owed; it may not report a shortfall.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LastThrustEndUt { get; set; }

    /// <summary>Payload provenance. <c>Source</c> is <c>"vessel:&lt;guid&gt;"</c> for the active vessel.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
