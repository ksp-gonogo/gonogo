#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.orbit.truth</c> channel payload: KSP's own maintained
/// ground-truth state vector, parent-body-relative. DEV-GATED, not a product
/// channel: exists so the
/// propagator-diff harness / a debug widget can verify element-&gt;position
/// math against KSP's own state, never as a widget-facing altitude/velocity
/// source (that would rebuild the elements-not-position discipline's failure
/// mode / V-12). <see cref="FrameRotating"/> gates whether
/// <see cref="Position"/>/<see cref="Velocity"/> are directly comparable to a
/// fixed-frame Kepler propagator's output (false) or sit in a frame
/// co-rotating with the body's spin instead (true); see
/// <c>Gonogo.KSP.KspHost.BuildOrbit</c>'s doc comment for the full
/// derivation. There is no engine-level "hide from the data picker" flag yet
/// (that's a future SDK/picker concern): this channel is dev-only BY
/// CONVENTION today, enforced by never binding it from a widget, not by
/// engine-level gating.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.orbit.truth")]
public class VesselOrbitTruth
{
    [SitrepUnit(Units.Metres)]
    /*
     * A state vector plus mu is a conic, so the pair advances together. frameRotating is declared
     * because the model is INAPPLICABLE when it is true: an input a reckoner uses to DECLINE is
     * still an input, and declaring it is what lets the decline name what ruled the model out.
     *
     * The modelled arm is for a debug overlay, NOT for the diff harness this channel exists to
     * feed. Reckoning it applies the very propagator the harness is measuring, so a consumer
     * diffing element->position math must read `value`: `reckoned` there compares the propagator
     * against itself and agrees perfectly by construction.
     */
    [SitrepReckonable(ReckoningBases.KeplerPropagation, "velocity", "frameRotating", "@vessel.orbit#mu")]
    public Vec3 Position { get; set; } = new();

    [SitrepUnit(Units.MetresPerSecond)]
    // The same conic seen from the other half of the state vector; see Position.
    [SitrepReckonable(ReckoningBases.KeplerPropagation, "position", "frameRotating", "@vessel.orbit#mu")]
    public Vec3 Velocity { get; set; } = new();

    [SitrepUnit(Units.Flag)]
    public bool FrameRotating { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
