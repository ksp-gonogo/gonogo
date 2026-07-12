#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The active vessel's physics-simulation regime, derived from KSP's own
/// <c>Vessel.loaded</c>/<c>Vessel.packed</c> flags (confirmed via decompile:
/// both are public <c>bool</c> fields on <c>Vessel</c>). This is the proper
/// Value that replaces the old "read stream meta" stand-in — physics mode is a
/// discrete enum in its own right, NOT a quality band on <see cref="PayloadMeta.Quality"/>
/// (2026-07-09 §0.0 reversal). Widgets that switch propagation/dead-reckoning
/// strategy (a.physicsMode consumers) read this to know whether the craft is
/// on-rails conics, a packed cluster, or a fully physics-simulated vessel.
///
/// <para>Mapping (see <c>Gonogo.KSP.KspHost.BuildPhysics</c> and
/// <c>Sitrep.Host.VesselViewProvider.BuildPhysicsMode</c>):
/// <list type="bullet">
/// <item><c>!loaded</c> ⇒ <see cref="OnRails"/> — the vessel is unloaded, its
/// motion is pure on-rails conic propagation, no PhysX at all.</item>
/// <item><c>loaded &amp;&amp; packed</c> ⇒ <see cref="Packed"/> — loaded into the
/// scene but still packed (rails-following near the active vessel, not yet
/// unpacked into full physics).</item>
/// <item><c>loaded &amp;&amp; !packed</c> ⇒ <see cref="Unpacked"/> — fully
/// physics-simulated (off-rails).</item>
/// </list></para>
///
/// <see cref="Unknown"/> is the graceful fallback for a raw value this contract
/// doesn't recognize (same convention as <see cref="SasMode"/>/<see cref="VesselType"/>).
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum PhysicsMode
{
    OnRails,
    Packed,
    Unpacked,
    Unknown,
}

/// <summary>
/// The <c>vessel.physics.mode</c> Topic payload — the active vessel's physics
/// regime (<see cref="PhysicsMode"/>). Its own Topic Value per the 2026-07-09
/// §0.0 decision (reverses the earlier "fold physics mode into stream meta"
/// call — <see cref="PayloadMeta.Quality"/> was a bad stand-in for a discrete
/// enum). <see cref="DelayRole"/>-Delayed like every other vessel-derived
/// channel: it describes the vessel itself, so ground learns about it at
/// UT+delay, not as a ground-side fact.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.physics.mode")]
public class VesselPhysicsMode
{
    public PhysicsMode Mode { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
