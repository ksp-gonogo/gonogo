#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Display-only per-vessel link facts on <c>fleet.&lt;guid&gt;.delay</c>: the
/// one-way light-time to that vessel and whether it is currently reachable. The
/// mod already computes both (<c>FleetCommsReader.ReadVessel</c>) to set the
/// per-vessel channel delay and per-subject freeze; this surfaces the same
/// numbers for the FleetRoster UI. Not a control input.
///
/// <para>Rides the Delayed <c>fleet.</c> namespace like <c>fleet.&lt;guid&gt;.orbit</c>,
/// so the value itself arrives light-time-late: honest (KSC's knowledge of a
/// distant vessel's link geometry IS that old) and consistent, and the value
/// varies slowly enough that the meta-lag is immaterial.</para>
///
/// <para>R7 typed-absence: <see cref="OneWaySeconds"/> is nullable, a vessel with
/// no comms path carries <c>null</c>, never a sentinel <c>0</c> that would read
/// as a zero-delay direct link.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class FleetVesselLink
{
    /// <summary>One-way light-time to this vessel, seconds. Null when there is no path (unreachable / torn-down state).</summary>
    [SitrepUnit(Units.Seconds)]
    public double? OneWaySeconds { get; set; }

    /// <summary>Whether this vessel is currently reachable (<c>v.connection.IsConnected</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }
}
