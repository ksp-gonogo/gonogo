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
