#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// What a docking port is doing, in KSP's own stages of a dock, as
/// <see cref="DockAlignment.OwnPortState"/> and <see cref="DockAlignment.TargetPortState"/>
/// report it. The variants a docked port reports for which side it is, and the
/// one for a port docked to its own vessel, all read as <see cref="Docked"/>.
///
/// <internal>
/// Member order is wire-significant, so members are only ever appended.
/// </internal>
/// </summary>
/// <category>Vessel</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum DockingPortState
{
    /// <summary>Free and not yet drawn to another port.</summary>
    Ready,
    /// <summary>The port's capture field has taken hold of another port and is pulling the two together.</summary>
    Acquire,
    /// <summary>The ports are joined and the two craft are about to become one.</summary>
    PreAttached,
    /// <summary>The ports are docked.</summary>
    Docked,
    /// <summary>The ports are letting go of each other after an undock.</summary>
    Disengage,
    /// <summary>The port is shut off and will not dock.</summary>
    Disabled,
}

/// <summary>
/// The relative position, velocity and
/// coarse orientation between the active vessel's nearest docking port
/// (one that is not shut off) and the targeted docking port, for docking-alignment widgets, with each port's
/// <see cref="DockingPortState"/> so a widget can tell a free approach from a capture and a dock.
/// The whole payload is absent when docking is not relevant right now: nothing
/// is targeted, the target is not a docking port, or the active vessel has no
/// port that is not disabled. It stays through the capture, the join and the release of the pair
/// last targeted, after the game clears the target, and is absent again once the own port is back at
/// rest. It is never an old or zero-distance placeholder record, the same
/// convention as <see cref="VesselTarget"/>.
///
/// <para><see cref="ForwardDot"/> is the dot product of the two ports' forward
/// (docking-axis) vectors: -1 means the ports face each other head-on (the
/// alignment a dock needs), +1 means they point the same way. It is the raw
/// dot product, so how to show it (for example as a percentage) is up to the
/// widget.</para>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.dock", DisplayName = "Active vessel docking")]
public class DockAlignment
{
    /// <summary>The target port's position relative to the own port (target minus own), metres, in the own
    /// port's axes: <c>z</c> is along the docking axis, <c>x</c> and <c>y</c> are
    /// the sideways and vertical offsets, so the line-of-sight angles off the port's boresight are
    /// <c>atan(x / z)</c> and <c>atan(y / z)</c>.</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepFrame(Frames.PortRelative)]
    // Same one-payload dead reckoning as vessel.target: the closing velocity is right here.
    [SitrepReckonable(ReckoningBases.LinearDeadReckoning, "relativeVelocity")]
    public Vec3 RelativePosition { get; set; } = new();

    /// <summary>The target port's velocity relative to the own port, m/s, in the own port's axes like
    /// <see cref="RelativePosition"/>.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    [SitrepFrame(Frames.PortRelative)]
    public Vec3 RelativeVelocity { get; set; } = new();

    /// <summary>Metres: <see cref="RelativePosition"/>'s magnitude, provided
    /// directly so a widget does not have to derive it every frame.</summary>
    [SitrepUnit(Units.Metres)]
    // The magnitude of a dead-reckoned separation: it needs the vector it is the magnitude of,
    // as well as the velocity, so both are declared rather than leaning on the implicit anchor.
    [SitrepReckonable(ReckoningBases.LinearDeadReckoning, "relativePosition", "relativeVelocity")]
    public double Distance { get; set; }

    /// <summary>Dot product of the own port's and target port's forward
    /// vectors, -1..1: -1 facing head-on, +1 pointing the same way. Null only
    /// when either port's transform was unavailable this tick.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? ForwardDot { get; set; }

    /// <summary>The active vessel's own docking port the alignment is measured from: the one nearest the
    /// target that is not <see cref="DockingPortState.Disabled"/>. Null only when the game did not report its state this tick.</summary>
    public DockingPortState? OwnPortState { get; set; }

    /// <summary>The targeted port's state. Null only when the game did not report it this tick.</summary>
    public DockingPortState? TargetPortState { get; set; }

    /// <summary>The targeted port's owning vessel's KSP <c>Vessel.persistentId</c>, the id a camera
    /// marker names the vessel by. Null only when the game did not report it this tick.</summary>
    [SitrepUnit(Units.Id)]
    public uint? TargetVesselPersistentId { get; set; }

    /// <summary>The targeted port's KSP <c>Part.persistentId</c>, the id a camera marker names the
    /// part by. Not <c>Part.flightID</c>, the id <c>vessel.target</c> carries. Null only when the game did not
    /// report it this tick.</summary>
    [SitrepUnit(Units.Id)]
    public uint? TargetPortPersistentId { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
