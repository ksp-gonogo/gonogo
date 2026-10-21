using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One craft's link figures on <c>trackingStation.vessel.&lt;guid&gt;.link</c>,
/// as the command centre last heard them: the one-way signal delay between the
/// craft and the ground, and whether the craft is reachable. The same numbers
/// the mod uses to delay that craft's channels, published for display. Not a
/// control input.
///
/// <para>Delayed by that craft's own signal delay, so the value arrives as old
/// as the command centre's knowledge of the link.</para>
///
/// <para>A craft with no comms path carries a null
/// <see cref="OneWaySeconds"/>, never a <c>0</c> that would read as a
/// zero-delay link.</para>
/// <internal>Computed by <c>FleetCommsReader.ReadVessel</c>, which also sets
/// the per-vessel channel delay and freeze.</internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TrackingStationVesselLink
{
    /// <summary>One-way signal delay to this vessel, in seconds. Null when there is
    /// no comms path to it.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? OneWaySeconds { get; set; }

    /// <summary>Whether this vessel is currently reachable
    /// (<c>v.connection.IsConnected</c>). Null when its link could not be
    /// read.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Connected { get; set; }
}

/// <summary>
/// One craft's resource amounts on
/// <c>trackingStation.vessel.&lt;guid&gt;.resources</c>, as the command centre
/// last heard them: the same keyed map <see cref="VesselResources"/> carries
/// for the active craft, for a craft you are not flying. A resource the craft
/// has no capacity for is absent from the map; one it carries but has emptied
/// is present with a current amount of <c>0</c>.
///
/// <para>Amounts only: no rate and no exhaustion time. Stock KSP does not
/// simulate consumption on an unloaded vessel, so a rate or exhaustion time
/// belongs to whichever Uplink models the draw, contributed on top of this.</para>
///
/// <para>Delayed by that craft's own signal delay. While the craft is out of
/// contact the reading is held at its last-known value.</para>
/// <internal>Loaded craft read their live parts, unloaded ones their
/// <c>ProtoPartSnapshot</c>s; a failed read omits the whole payload rather
/// than publishing a partial tank list. Not freeze-exempt, unlike its
/// siblings.</internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TrackingStationVesselResources
{
    /// <summary>
    /// The vessel's resources keyed by KSP resource name (for example
    /// <c>"LiquidFuel"</c>), each summed across every part that holds it. Never
    /// null; empty for a craft that carries no resources.
    /// </summary>
    public Dictionary<string, ResourceAmount> Resources { get; set; } = new Dictionary<string, ResourceAmount>();
}

/// <summary>
/// One craft's part tree on <c>trackingStation.vessel.&lt;guid&gt;.parts</c>,
/// as the command centre last heard it: each part's position, axes and box in
/// the craft's own frame, the same <see cref="VesselPart"/> rows
/// <c>vessel.parts</c> carries for the active craft, for any craft in the
/// save. Published only while something subscribes to that craft's topic.
///
/// <para>How exact it is depends on whether the craft is loaded. A loaded
/// craft (the active one, or one within physics range of it) is read from its
/// live parts, exactly as <c>vessel.parts</c> reads it. An unloaded craft is
/// read from its saved part snapshots: positions and orientations are the
/// saved ones and exact, but each part's box is measured on the part's stock
/// model, so a part showing a non-default variant can be drawn at the wrong
/// size, and the craft carries no temperatures, no flow rates, no module
/// states, no action-group bindings and no fuel-line targets.</para>
///
/// <para>Delayed by that craft's own signal delay. While the craft is out of
/// contact the reading is held at its last-known value, and a craft never
/// heard from since the topic was opened has none.</para>
/// <internal>Loaded craft read through KspHost's topology walk, unloaded ones
/// through ProtoVesselTopology. Subscription-gated per craft in
/// FleetChannels, so only a craft someone has open is measured.</internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TrackingStationVesselParts
{
    /// <summary>Every part on the craft, in the craft's part-list order. Never
    /// null; a reading that cannot be taken publishes nothing rather than an
    /// empty or partial list.</summary>
    public List<VesselPart> Parts { get; set; } = new();
}
