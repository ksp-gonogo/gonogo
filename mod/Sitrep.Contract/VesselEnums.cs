#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Mirrors KSP's own <c>Vessel.Situations</c> enum by concept (member names
/// here are this contract's own PascalCase spelling — <c>Sitrep.Host.
/// VesselViewProvider</c>'s <c>ParseSituation</c> maps KSP's raw
/// SCREAMING_SNAKE_CASE <c>.ToString()</c> onto these, never passing the raw
/// string through directly). Kills V-13: the <c>v.situation</c>/
/// <c>v.situationString</c>/<c>v.landedAt</c> triplet collapses to this one
/// typed field. <see cref="Unknown"/> is the graceful fallback for a raw
/// value this contract doesn't yet recognize, rather than the mapper
/// throwing on a future KSP version adding a situation.
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum Situation
{
    Landed,
    Splashed,
    PreLaunch,
    Orbiting,
    Escaping,
    Flying,
    SubOrbital,
    Docked,
    Unknown,
}

/// <summary>
/// Mirrors KSP's own <c>VesselType</c> enum. KSP's <c>.ToString()</c> already
/// yields PascalCase matching these members, so the mapper uses a
/// case-insensitive <c>Enum.TryParse</c> rather than a hand-written switch
/// (see <c>VesselViewProvider.ParseVesselType</c>). <see cref="Unknown"/> both
/// mirrors KSP's own <c>Unknown</c> member and is the fallback for a value
/// this contract doesn't recognize yet.
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum VesselType
{
    Ship,
    Station,
    Lander,
    Probe,
    Rover,
    Base,
    Relay,
    EVA,
    Flag,
    Debris,
    SpaceObject,
    DeployedScienceController,
    DeployedSciencePart,
    DroppedPart,
    Unknown,
}

/// <summary>
/// Mirrors KSP's <c>Orbit.PatchTransitionType</c> — parsed from the raw
/// <c>orbit.patchEndTransition.ToString()</c> value <c>KspHost</c> captures.
/// <see cref="Unknown"/> is the graceful fallback.
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum TransitionType
{
    Initial,
    Final,
    Encounter,
    Escape,
    Maneuver,
    Collision,
    Unknown,
}
