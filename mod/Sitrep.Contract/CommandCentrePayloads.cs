using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One command centre in the <c>commandCentre.roster</c> channel: a vantage/
/// authority the operator can command from and observe at (Plan 3). The union of
/// the stock CommNet home nodes (KSC, Extra Ground Stations, Kerbal Konstructs
/// sites) and crewed control-source vessels. Produced by the mod's command-centre
/// enumeration pass.
///
/// <para>The channel is a BARE ARRAY of these entries (tagged <c>isArray: true</c>,
/// like <see cref="SpaceCenterPoiEntry"/>), one per active centre keyed by
/// <see cref="Id"/>. A TS-shape-only typing/codegen marker: the producer
/// hand-flattens each centre to a dictionary, this POCO never serializes raw.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("commandCentre.roster", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommandCentreEntry
{
    /// <summary>Stable authority/vantage key: <c>"ksc"</c> | <c>"ground:&lt;name&gt;"</c> | <c>"kk:&lt;site&gt;"</c> | <c>"vessel:&lt;guid&gt;"</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>Human-facing name.</summary>
    [SitrepUnit(Units.Text)]
    public string? DisplayName { get; set; }

    /// <summary>One of <c>GroundStation</c> / <c>CrewedVessel</c> / <c>Colony</c> / <c>Custom</c> (the <c>CommandCentreKind</c> name).</summary>
    [SitrepUnit(Units.Text)]
    public string? Kind { get; set; }

    /// <summary>Index into <see cref="SystemBodies"/> of the body this centre sits on; null when unknown or not surface-anchored.</summary>
    [SitrepUnit(Units.Id)]
    public int? BodyIndex { get; set; }

    /// <summary>
    /// Body-fixed surface latitude of the centre in degrees, when surface-anchored;
    /// null for a moving vessel centre.
    ///
    /// <para><b>Null is "not applicable", not "not computed".</b> A
    /// <c>GroundStation</c> always reports coordinates. A <c>CrewedVessel</c> reports
    /// them only while landed, splashed or pre-launch: off the ground the only thing
    /// derivable is a sub-vessel ground point that sweeps at orbital rate, which is
    /// not a place the centre occupies. So null says the centre is airborne or in
    /// space, and a client may act on that rather than treating it as missing data.
    /// The one case where an anchored centre reports null is a body that could not be
    /// read at all, and then <see cref="BodyIndex"/> is null too: the two travel
    /// together, so a null coordinate never appears beside a known body.</para>
    ///
    /// <para>Always null or non-null together with <see cref="Longitude"/>.</para>
    /// </summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Body-fixed surface longitude of the centre in degrees, wrapped to (-180, 180], matching every other geographic value on the wire. Null under exactly the rule <see cref="Latitude"/> documents, and always null together with it.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }

    /// <summary>Whether this centre is a valid command source right now.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Active { get; set; }

    /// <summary>
    /// Whether this centre can be routed to: <c>"routed"</c> (a CommNode
    /// ControlPath exists, occlusion-aware) or <c>"unroutable"</c> (no CommNode,
    /// so no command path and no delay). There is deliberately no
    /// position-only approximation: commands ride the relay network, and a pair
    /// with no route has no delay to quote.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? DelayQuality { get; set; }
}

/// <summary>
/// One ordered pair in the <c>commandCentre.separation</c> channel: how far
/// <see cref="From"/> is from <see cref="To"/>, in one-way seconds along the
/// routed CommNet path.
///
/// <para>Both ends are command-centre ids from <c>commandCentre.roster</c>, so a
/// pair is a ground station against another ground station, a crewed craft
/// against a ground station, or two crewed craft: a crewed control-source vessel
/// IS a centre, so no separate vocabulary is needed for it.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CentreSeparationEntry
{
    /// <summary>The centre the separation is measured FROM, as a roster <c>Id</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string From { get; set; } = "";

    /// <summary>The centre the separation is measured TO, as a roster <c>Id</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string To { get; set; } = "";

    /// <summary>One-way signal time along the routed path between the two.</summary>
    [SitrepUnit(Units.Seconds)]
    public double OneWaySeconds { get; set; }
}

/// <summary>
/// How far every active command centre is from every other, one-way, along the
/// routed CommNet path. The number a human at one vantage needs to know how long
/// their words take to reach a human at another.
///
/// <para><b>Sparse, and that is the contract.</b> A pair with no route has NO
/// entry rather than a zero or a sentinel: commands and messages ride the relay
/// network, so an unroutable pair has no separation to quote, and inventing one
/// would make an unreachable correspondent look merely distant. A reader that
/// finds no entry for a pair knows the separation is unavailable, which is a
/// different fact from it being large.</para>
///
/// <para>Each centre against ITSELF is always present as an explicit zero: a
/// node is exactly no distance from itself, and without the row a reader would
/// fall through to "unavailable" for the one pair it is most certain about.</para>
///
/// <para>TRUE-NOW, on the same reasoning as <c>comms.delay</c>: this value GATES
/// the reveal of things sent between vantages, so delaying it would make the
/// gate depend on itself, and freezing it through a blackout would hold a stale
/// separation exactly when the geometry is changing.
/// <internal>
/// Published from the rows <c>CommandCentreDelayUplink.CaptureLedgerOnMain</c>
/// already builds for the engine's delay ledger, filtered to the
/// <c>centre.</c> node namespace. No additional graph solve: the pass that
/// writes the ledger is the pass that produces these.
/// </internal></para>
/// </summary>
[SitrepContract]
[SitrepTopic("commandCentre.separation")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommandCentreSeparation
{
    /// <summary>Every ordered pair with a routed path, plus each centre's own zero.</summary>
    public IReadOnlyList<CentreSeparationEntry> Pairs { get; set; } = new List<CentreSeparationEntry>();
}
