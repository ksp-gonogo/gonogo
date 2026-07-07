#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One planned maneuver node — NAMED delta-v components in the node's own
/// radial/normal/prograde frame. Kills O-4: Telemachus's
/// <c>o.addManeuverNode[ut, x, y, z]</c> (where <c>[x,y,z]</c> is secretly
/// <c>[radialOut, normal, prograde]</c>, with <c>updateManeuverNode</c>
/// prepending an <c>id</c> that shifts every subsequent index by one, and a
/// THIRD, different display order) is the textbook arg-order footgun this
/// named shape makes impossible to mis-order.
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ManeuverNode
{
    public double Ut { get; set; }

    public double DvRadial { get; set; }

    public double DvNormal { get; set; }

    public double DvPrograde { get; set; }

    public double DvTotal { get; set; }
}

/// <summary>
/// The <c>vessel.maneuver</c> channel payload. <see cref="Nodes"/> is ALWAYS
/// an array — kills R2's empty-vs-null inconsistency (KspHost's
/// <c>BuildManeuverNodes</c> returns <c>null</c> for "no nodes queued," the
/// common case; this mapper normalizes that to <c>[]</c>, never a null
/// collection). *Derived, SDK-side, NOT streamed here:* the post-burn orbit
/// preview (elements + node → new elements — consumer-side math, per the
/// design doc §2.2/§5).
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselManeuver
{
    public List<ManeuverNode> Nodes { get; set; } = new();

    public Meta Meta { get; set; } = new();
}
