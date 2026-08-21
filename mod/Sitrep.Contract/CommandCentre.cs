using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The kind of a command centre. <see cref="CrewedVessel"/> is load-bearing:
    /// a crewed-vessel centre whose <see cref="ICommandCentre.Id"/> equals the
    /// subject being routed must be excluded from that subject's authority set,
    /// else route(self -&gt; self) = 0 reports 0 command delay for every crewed
    /// craft to a KSC operator on full light-time (delay-spec red-team BLOCKER-2).
    /// </summary>
    public enum CommandCentreKind
    {
        GroundStation,
        CrewedVessel,
        Colony,
        Custom,
    }

    /// <summary>
    /// A command centre is a vantage/authority in the per-(vantage, subject) delay
    /// model: a physical place you command from. This interface is the KSP-free
    /// IDENTITY view (id, name, kind, body) plus the "is a valid command source
    /// right now" predicate. The routing geometry (the CommNet node / position that
    /// <c>SignalDelay.Compute</c> consumes) lives in the KSP-layer source that
    /// produces the centre, never here: Sitrep.Host references no KSP/Unity
    /// assemblies, and the per-(centre, subject) routing runs in the KSP layer.
    /// </summary>
    public interface ICommandCentre
    {
        /// <summary>Stable authority/vantage key: "ksc" | "ground:&lt;name&gt;" | "kk:&lt;site&gt;" | "vessel:&lt;guid&gt;".</summary>
        string Id { get; }

        /// <summary>Human-facing name.</summary>
        string DisplayName { get; }

        /// <summary>What kind of centre this is (drives self-exclusion for crewed vessels).</summary>
        CommandCentreKind Kind { get; }

        /// <summary>Index into system.bodies of the body this centre sits on; null when unknown or not surface-anchored.</summary>
        int? BodyIndex { get; }

        /// <summary>Whether this is a valid command source right now (crew present, difficulty on, powered, node exists).</summary>
        bool IsActiveNow();
    }

    /// <summary>
    /// A self-registering enumerator of command centres. Static sources (home
    /// nodes) yield the same centres every pass; dynamic sources (crewed control
    /// vessels appear/disappear/move) yield 0..N live per call, so the contract is
    /// "enumerate live", not "register individual centres once".
    /// </summary>
    public interface ICommandCentreSource : ISitrepProvider
    {
        IEnumerable<ICommandCentre> Enumerate();
    }
}
