#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.dock</c> channel payload — the docking/rendezvous
/// capture-add (M3 R3): relative position/velocity + coarse orientation
/// between the active vessel's nearest FREE (undocked) docking port and the
/// currently-targeted docking port, for docking-alignment widgets. Whole-
/// channel absence means "not docking-relevant right now" — no target
/// targeted, the target isn't itself a docking port, or the active vessel
/// has no free port of its own — never a stale/zero-distance sentinel
/// record (same R1(b) convention <see cref="VesselTarget"/> already
/// established).
///
/// <para>Reuses the ONE canonical <see cref="Vec3"/> shape (never a second
/// vector encoding). <see cref="ForwardDot"/> is the dot product of the two
/// ports' forward (docking-axis) vectors: -1.0 means the ports face each
/// other head-on (the alignment a successful dock needs), +1.0 means they
/// point the same direction (facing away from each other) — a widget maps
/// this to a 0..100% "facing" readout however it likes; this contract
/// intentionally ships the raw dot product rather than a pre-baked
/// percentage so the mapping stays a client concern.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class DockAlignment
{
    /// <summary>Metres, own-port-relative (target port minus own port).</summary>
    public Vec3 RelativePosition { get; set; } = new();

    /// <summary>m/s, own-port-relative.</summary>
    public Vec3 RelativeVelocity { get; set; } = new();

    /// <summary>Metres — <see cref="RelativePosition"/>'s magnitude, provided directly so a widget doesn't have to re-derive it every frame.</summary>
    public double Distance { get; set; }

    /// <summary>Dot product of the own port's and target port's forward vectors — see the class doc comment. Null only if either port's transform was unavailable this tick.</summary>
    public double? ForwardDot { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
