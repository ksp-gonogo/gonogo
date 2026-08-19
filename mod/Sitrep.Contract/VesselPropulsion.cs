#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.propulsion</c> channel payload: the TWR/burn-time
/// derivation inputs (G-4). <see cref="TotalMass"/>/<see cref="DryMass"/> in
/// tonnes, <see cref="CurrentThrust"/>/<see cref="AvailableThrust"/> in kN
/// (dimensionally consistent for TWR: kN/(t·m/s²): see
/// m1-provider-taxonomy-design.md §6.7). <see cref="AvailableThrust"/>
/// already excludes shut-down/flamed-out engines at capture (only
/// <c>EngineIgnited &amp;&amp; !flameout</c> engines contribute): it is
/// "what this vessel can produce RIGHT NOW," not its rated maximum.
/// *Derived, SDK-side, NOT streamed here:* TWR
/// (<c>currentThrust / (totalMass · g)</c>), max-TWR, and a crude vessel-level
/// burn-time estimate (retiring <c>dv.currentTWR</c>/<c>dv.*</c> until a
/// stage sim exists, G-14).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.propulsion")]
public class VesselPropulsion
{
    [SitrepUnit(Units.Tonnes)]
    public double TotalMass { get; set; }

    [SitrepUnit(Units.Tonnes)]
    public double DryMass { get; set; }

    [SitrepUnit(Units.Kilonewtons)]
    public double CurrentThrust { get; set; }

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
    /// <para>Latched rather than emitted as an edge, and that is the whole
    /// design. Every vessel channel is <c>Delivery.LossyLatest</c> over a
    /// UT-gated snapshot, so a "thrust just started" event is a one-shot the
    /// transport is entitled to drop, and a consumer that missed it cannot tell
    /// that from nothing having happened. A latched instant is on every
    /// subsequent frame until it changes.</para>
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

    public PayloadMeta Meta { get; set; } = new();
}
