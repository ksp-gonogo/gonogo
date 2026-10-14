using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Per-vessel link facts on <c>fleet.&lt;guid&gt;.delay</c>: the one-way
/// signal delay to that vessel and whether it is currently reachable. The same
/// numbers the mod uses to delay that vessel's channels, published for display.
/// Not a control input.
///
/// <para>Delayed like <c>fleet.&lt;guid&gt;.orbit</c>, so the value itself
/// arrives one signal delay late, which is how old the space centre's knowledge
/// of the link is.</para>
///
/// <para>A vessel with no comms path carries a null
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
public class FleetVesselLink
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
/// One fleet vessel's resource amounts on <c>fleet.&lt;guid&gt;.resources</c>:
/// the same keyed map <see cref="VesselResources"/> carries for the active
/// craft, for a craft you are not flying. A resource the craft has no capacity
/// for is absent from the map; one it carries but has emptied is present with
/// a current amount of <c>0</c>.
///
/// <para>Amounts only: no rate and no exhaustion time. Stock KSP does not
/// simulate consumption on an unloaded vessel, so a rate or exhaustion time
/// belongs to whichever Uplink models the draw, contributed on top of this.</para>
///
/// <para>Delayed like <c>fleet.&lt;guid&gt;.orbit</c>, so the reading arrives
/// one signal delay late. While the craft is out of contact the reading is held
/// at its last-known value.</para>
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
public class FleetVesselResources
{
    /// <summary>
    /// The vessel's resources keyed by KSP resource name (for example
    /// <c>"LiquidFuel"</c>), each summed across every part that holds it. Never
    /// null; empty for a craft that carries no resources.
    /// </summary>
    public Dictionary<string, ResourceAmount> Resources { get; set; } = new Dictionary<string, ResourceAmount>();
}
