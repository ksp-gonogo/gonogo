using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The route a message sent now would take between each command centre and the
/// active craft, in both directions, predicted from the contact plan: the
/// earliest arrival over every relay, waiting at a node for its next window where
/// that arrives sooner.
///
/// <para>A prediction. The live link the game reports decides what actually gets
/// through, and today only a <see cref="CommsRoute.Live"/> route delivers: a
/// message whose route would have to wait anywhere is not held for that window,
/// so it is lost.</para>
///
/// <para>Each session receives only the rows that start or end at its own
/// vantage. DELAYED, so a centre learns its routes one of its own light-times
/// after they were planned.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
[SitrepTopic("comms.route")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsRoutes
{
    /// <summary>One row per direction between a command centre and the active craft.</summary>
    public List<CommsRoute> Routes { get; set; } = new List<CommsRoute>();
}

/// <summary>The route from one node to another for a message sent at <see cref="SentUt"/>.</summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsRoute
{
    /// <summary>Where the message leaves from, in the <c>commandCentre.roster</c> vocabulary: <c>"ground:&lt;name&gt;"</c> or <c>"vessel:&lt;guid&gt;"</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string From { get; set; } = "";

    /// <summary>Where it is going, in the same vocabulary.</summary>
    [SitrepUnit(Units.Id)]
    public string To { get; set; } = "";

    /// <summary>The send instant the route was planned for.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double SentUt { get; set; }

    /// <summary>When the message would arrive, waits included, or <c>null</c> when no route is predicted before the plan's horizon.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ArrivalUt { get; set; }

    /// <summary>Whether every hop leaves the moment the message reaches its node, so nothing would wait anywhere. False when there is no route.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Live { get; set; }

    /// <summary>
    /// Every node the message would wait at, in route order: where it is held,
    /// when it gets there and when it is predicted to leave. Empty for a live route
    /// and for no route. The sender itself is the first hold when the message has
    /// to wait before its first hop.
    /// </summary>
    public List<CommsRouteHold> Holds { get; set; } = new List<CommsRouteHold>();
}

/// <summary>One stretch a routed message would spend held at a node, waiting for its next window.</summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsRouteHold
{
    /// <summary>The node holding it, in the <c>commandCentre.roster</c> vocabulary.</summary>
    [SitrepUnit(Units.Id)]
    public string At { get; set; } = "";

    /// <summary>When the message reaches the node, or is sent from it.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double ArriveUt { get; set; }

    /// <summary>When it is predicted to leave on its next hop.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double DepartUt { get; set; }
}
