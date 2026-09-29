#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.dock</c> channel payload: the relative position, velocity and
/// coarse orientation between the active vessel's nearest free (undocked)
/// docking port and the targeted docking port, for docking-alignment widgets.
/// The whole payload is absent when docking is not relevant right now: nothing
/// is targeted, the target is not a docking port, or the active vessel has no
/// free port. It is never an old or zero-distance placeholder record, the same
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
[SitrepTopic("vessel.dock")]
public class DockAlignment
{
    /// <summary>The target port's position relative to the own port (target minus own), metres.</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepFrame(Frames.SubjectRelative)]
    // Same one-payload dead reckoning as vessel.target: the closing velocity is right here.
    [SitrepReckonable(ReckoningBases.LinearDeadReckoning, "relativeVelocity")]
    public Vec3 RelativePosition { get; set; } = new();

    /// <summary>The target port's velocity relative to the own port, m/s.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    [SitrepFrame(Frames.SubjectRelative)]
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

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
