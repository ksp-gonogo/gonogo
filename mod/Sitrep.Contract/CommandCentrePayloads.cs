#if NETSTANDARD2_0
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
#if NETSTANDARD2_0
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

    /// <summary>Surface latitude of the centre, when surface-anchored; null for a moving vessel centre.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Surface longitude of the centre, when surface-anchored; null for a moving vessel centre.</summary>
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
