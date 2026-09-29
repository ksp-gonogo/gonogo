#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// A vessel's flight situation, KSP's <c>Vessel.situation</c> (the
/// <c>Vessel.Situations</c> enum) in this contract's PascalCase spelling.
/// <see cref="Unknown"/> stands for a value this contract does not recognise,
/// such as a situation added by a later KSP version.
/// <internal>
/// SharedMappers.ParseSituation maps KSP's SCREAMING_SNAKE_CASE ToString()
/// onto these members rather than passing the raw string through.
/// </internal>
/// </summary>
/// <category>Vessel</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum Situation
{
    /// <summary>Resting on the surface of a body (KSP <c>LANDED</c>).</summary>
    Landed,

    /// <summary>Floating on water (KSP <c>SPLASHED</c>).</summary>
    Splashed,

    /// <summary>On the launch pad or runway and not yet launched (KSP <c>PRELAUNCH</c>).</summary>
    PreLaunch,

    /// <summary>In a closed orbit that does not intersect the surface or atmosphere (KSP <c>ORBITING</c>).</summary>
    Orbiting,

    /// <summary>On a trajectory that leaves the current body's sphere of influence (KSP <c>ESCAPING</c>).</summary>
    Escaping,

    /// <summary>In the atmosphere and off the ground (KSP <c>FLYING</c>).</summary>
    Flying,

    /// <summary>Above the atmosphere on a trajectory that meets the surface or atmosphere again (KSP <c>SUB_ORBITAL</c>).</summary>
    SubOrbital,

    /// <summary>Docked to another vessel (KSP <c>DOCKED</c>).</summary>
    Docked,

    /// <summary>A situation this contract does not recognise.</summary>
    Unknown,
}

/// <summary>
/// A vessel's type, KSP's <c>Vessel.vesselType</c> (the <c>VesselType</c>
/// enum), with the same member names. <see cref="Unknown"/> is both KSP's own
/// <c>Unknown</c> type and the value for a type this contract does not
/// recognise.
/// </summary>
/// <category>Vessel</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum VesselType
{
    /// <summary>A crewed or general-purpose ship.</summary>
    Ship,

    /// <summary>A space station.</summary>
    Station,

    /// <summary>A lander.</summary>
    Lander,

    /// <summary>An uncrewed probe.</summary>
    Probe,

    /// <summary>A rover.</summary>
    Rover,

    /// <summary>A surface base.</summary>
    Base,

    /// <summary>A communications relay.</summary>
    Relay,

    /// <summary>A kerbal on EVA.</summary>
    EVA,

    /// <summary>A planted flag.</summary>
    Flag,

    /// <summary>Debris, such as a spent stage or a jettisoned fairing.</summary>
    Debris,

    /// <summary>An asteroid or comet.</summary>
    SpaceObject,

    /// <summary>A deployed science station's central control unit (Breaking Ground).</summary>
    DeployedScienceController,

    /// <summary>A deployed science experiment or power part other than the controller (Breaking Ground).</summary>
    DeployedSciencePart,

    /// <summary>A part dropped from a vessel, such as a piece of ground equipment.</summary>
    DroppedPart,

    /// <summary>KSP's own unknown type, or a type this contract does not recognise.</summary>
    Unknown,
}

/// <summary>
/// How an orbit patch begins or ends, KSP's <c>Orbit.PatchTransitionType</c>
/// (read from <c>Orbit.patchStartTransition</c> and
/// <c>Orbit.patchEndTransition</c>). Member names follow KSP's except
/// <see cref="Collision"/>, which is KSP's <c>IMPACT</c>.
/// <see cref="Unknown"/> stands for a value this contract does not recognise.
/// </summary>
/// <category>Vessel</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum TransitionType
{
    /// <summary>The patch starts at the vessel's current position: the first patch of a trajectory.</summary>
    Initial,

    /// <summary>The patch does not end in a transition: the trajectory continues on it indefinitely.</summary>
    Final,

    /// <summary>The trajectory enters another body's sphere of influence.</summary>
    Encounter,

    /// <summary>The trajectory leaves the current body's sphere of influence.</summary>
    Escape,

    /// <summary>The patch ends or begins at a planned maneuver node.</summary>
    Maneuver,

    /// <summary>The trajectory meets the body's surface (KSP <c>IMPACT</c>), with or without an atmosphere.</summary>
    Collision,

    /// <summary>A transition this contract does not recognise.</summary>
    Unknown,
}

/// <summary>
/// The basis a planned burn's delta-v components are expressed in. The two
/// bases are easy to mistake for each other and give different components, so
/// read this before interpreting a burn vector.
/// </summary>
/// <category>Orbits and trajectories</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum ManeuverFrame
{
    /// <summary>
    /// KSP's own maneuver-node basis: radial-out, normal, prograde, taken
    /// against the patch the node sits on at its own UT.
    /// </summary>
    RadialNormalPrograde,

    /// <summary>
    /// The Frenet trihedron of the trajectory at the burn point: tangent,
    /// normal, binormal. Not a renaming of
    /// <see cref="RadialNormalPrograde"/>: the axes differ, and for an
    /// eccentric orbit they differ by an amount that matters.
    /// </summary>
    TangentNormalBinormal,

    /// <summary>A frame this contract does not recognise.</summary>
    Unknown,
}
