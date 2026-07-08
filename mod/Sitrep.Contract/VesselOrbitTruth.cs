#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.orbit.truth</c> channel payload — KSP's own maintained
/// ground-truth state vector, parent-body-relative. DEV-GATED, not a product
/// channel (m1-provider-taxonomy-design.md §6.5): exists so the
/// propagator-diff harness / a debug widget can verify element-&gt;position
/// math against KSP's own state, never as a widget-facing altitude/velocity
/// source (that would rebuild the elements-not-position discipline's failure
/// mode / V-12). <see cref="FrameRotating"/> gates whether
/// <see cref="Position"/>/<see cref="Velocity"/> are directly comparable to a
/// fixed-frame Kepler propagator's output (false) or sit in a frame
/// co-rotating with the body's spin instead (true) — see
/// <c>Gonogo.KSP.KspHost.BuildOrbit</c>'s doc comment for the full
/// derivation. There is no engine-level "hide from the data picker" flag yet
/// (that's a future SDK/picker concern) — this channel is dev-only BY
/// CONVENTION today, enforced by never binding it from a widget, not by
/// engine-level gating.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselOrbitTruth
{
    public Vec3 Position { get; set; } = new();

    public Vec3 Velocity { get; set; } = new();

    public bool FrameRotating { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
