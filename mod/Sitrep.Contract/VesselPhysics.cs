#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The active vessel's physics-simulation regime, derived from KSP's own
/// <c>Vessel.loaded</c> and <c>Vessel.packed</c> flags. It is a discrete enum in
/// its own right, NOT a quality band on <see cref="PayloadMeta.Quality"/>. A
/// widget that switches propagation or dead-reckoning strategy reads it to know
/// whether the craft is on-rails conics, a packed cluster, or a fully
/// physics-simulated vessel.
///
/// <para>Mapping:
/// <list type="bullet">
/// <item><c>!loaded</c> ⇒ <see cref="OnRails"/>: the vessel is unloaded, its
/// motion is pure on-rails conic propagation, no PhysX at all.</item>
/// <item><c>loaded &amp;&amp; packed</c> ⇒ <see cref="Packed"/>: loaded into the
/// scene but still packed (rails-following near the active vessel, not yet
/// unpacked into full physics).</item>
/// <item><c>loaded &amp;&amp; !packed</c> ⇒ <see cref="Unpacked"/>: fully
/// physics-simulated (off-rails).</item>
/// </list></para>
///
/// <see cref="Unknown"/> covers a raw value this contract does not recognise
/// (same convention as <see cref="SasMode"/> and <see cref="VesselType"/>).
/// <internal>
/// See <c>Gonogo.KSP.KspHost.BuildPhysics</c> and
/// <c>Sitrep.Host.VesselViewProvider.BuildPhysicsMode</c>.
/// </internal>
/// </summary>
/// <category>Vessel</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum PhysicsMode
{
    /// <summary>Not loaded: pure on-rails conic propagation, no physics simulation.</summary>
    OnRails,

    /// <summary>Loaded into the scene but still packed, following rails near the active vessel.</summary>
    Packed,

    /// <summary>Loaded and unpacked: fully physics-simulated, off rails.</summary>
    Unpacked,

    /// <summary>A raw value this contract does not recognise.</summary>
    Unknown,
}

/// <summary>
/// The <c>vessel.physics.mode</c> Topic payload: the active vessel's physics
/// regime (<see cref="PhysicsMode"/>). Delayed (<see cref="DelayRole"/>) like
/// every other vessel-derived channel: it describes the vessel itself, so the
/// ground learns about it at UT+delay, not as a ground-side fact. Absent when
/// there is no active vessel.
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.physics.mode")]
public class VesselPhysicsMode
{
    /// <summary>The active vessel's physics regime.</summary>
    [SitrepUnit(Units.Enumeration)]
    public PhysicsMode Mode { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
