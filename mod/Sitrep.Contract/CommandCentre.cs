using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The kind of a command centre.
    ///
    /// <para><see cref="CrewedVessel"/> changes delay: a crewed-vessel centre
    /// whose <see cref="ICommandCentre.Id"/> names the subject being routed is
    /// at zero delay to that subject, because a vantage observing itself is no
    /// distance from itself.</para>
    /// <internal>
    /// Sitrep.Host.CommandCentres.AuthorityMatrixPass.Populate writes the zero;
    /// the routed graph cannot supply it for a path whose two ends are one node.
    /// </internal>
    /// </summary>
    /// <category>Uplink API</category>
    public enum CommandCentreKind
    {
        /// <summary>A fixed ground station, such as a CommNet home node.</summary>
        GroundStation,
        /// <summary>A crewed vessel acting as a command centre. <see cref="ICommandCentre.Id"/> is <c>"vessel:&lt;guid&gt;"</c>.</summary>
        CrewedVessel,
        /// <summary>A colony or other off-world base.</summary>
        Colony,
        /// <summary>Any other kind of centre an Uplink defines.</summary>
        Custom,
    }

    /// <summary>
    /// A command centre: a physical place you command from, the vantage in the
    /// per-(vantage, subject) signal delay model. This interface is the
    /// identity view (id, name, kind, body, surface position) plus whether it
    /// is a valid command source right now. The routing geometry stays with the
    /// Uplink that produces the centre.
    /// <internal>The CommNet node or position that <c>SignalDelay.Compute</c>
    /// consumes lives in the KSP-layer source, because Sitrep.Host references no
    /// KSP or Unity assemblies.</internal>
    /// </summary>
    /// <category>Uplink API</category>
    public interface ICommandCentre
    {
        /// <summary>Stable vantage key, same scheme as <see cref="CommandCentreEntry.Id"/>: <c>"ground:&lt;name&gt;"</c> or <c>"vessel:&lt;guid&gt;"</c>. Unique across every active centre.</summary>
        string Id { get; }

        /// <summary>Human-facing name.</summary>
        string DisplayName { get; }

        /// <summary>What kind of centre this is. A <see cref="CommandCentreKind.CrewedVessel"/> is at zero delay to itself.</summary>
        CommandCentreKind Kind { get; }

        /// <summary>Index into <c>system.bodies</c> of the body this centre sits on; null when unknown or not on a surface.</summary>
        int? BodyIndex { get; }

        /// <summary>
        /// Body-fixed surface latitude in degrees, under the rule
        /// <see cref="CommandCentreEntry.Latitude"/> states: a ground station always has
        /// one, a crewed vessel only while it sits on the surface, and an unreadable body
        /// makes it null together with <see cref="BodyIndex"/>.
        /// </summary>
        double? Latitude { get; }

        /// <summary>Body-fixed surface longitude in degrees, wrapped to (-180, 180]. Null exactly when <see cref="Latitude"/> is.</summary>
        double? Longitude { get; }

        /// <summary>Whether this is a valid command source right now (crew present, difficulty on, powered, node exists).</summary>
        bool IsActiveNow();
    }

    /// <summary>
    /// A source of command centres, registered as a provider. Static sources
    /// (home nodes) yield the same centres every call; dynamic ones (crewed
    /// vessels, which appear, disappear and move) yield whatever is live, so a
    /// source is enumerated each time rather than registering centres once.
    /// </summary>
    /// <category>Uplink API</category>
    public interface ICommandCentreSource : ISitrepProvider
    {
        /// <summary>
        /// Every command centre this source knows about right now.
        ///
        /// <para>Live read, main thread only, and the set changes between calls: a
        /// caller enumerates when it needs the set rather than holding onto one.
        /// Never <c>null</c>: a source with nothing to report returns an empty
        /// sequence.</para>
        /// </summary>
        IEnumerable<ICommandCentre> Enumerate();
    }
}
