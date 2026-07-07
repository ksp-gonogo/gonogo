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
    /// <summary>
    /// Stable, opaque id — the M3 R3 fix for the read/write correlation gap
    /// (<c>packages/sitrep-client/src/map-command.ts</c>'s <c>KNOWN_COMMAND_GAPS</c>
    /// comment): assigned by <c>Gonogo.KSP.KspHost</c> via a shared
    /// <c>ReferenceIdRegistry&lt;global::ManeuverNode&gt;</c> (see that
    /// class's doc comment for the full scheme), the SAME instance
    /// <c>KspVesselActuator</c> uses to resolve <c>vessel.maneuver.update</c>/
    /// <c>.remove</c>'s <c>nodeId</c> argument — so a node's id round-trips
    /// into those commands whether the node was created through
    /// <c>vessel.maneuver.add</c> or placed by hand in the map view.
    /// Empty string only for a node read off a recording captured BEFORE
    /// this field existed (replay of old data — never a live capture).
    /// </summary>
    public string Id { get; set; } = "";

    public double Ut { get; set; }

    /// <summary>
    /// Null only if KSP's own dv component was non-finite (NaN/Infinity) this
    /// tick — the NODE is still preserved (never silently dropped just
    /// because one component came back bad); see
    /// <c>VesselViewProvider.BuildManeuver</c>.
    /// </summary>
    public double? DvRadial { get; set; }

    /// <summary>Null only if KSP's own dv component was non-finite this tick — see <see cref="DvRadial"/>'s doc comment.</summary>
    public double? DvNormal { get; set; }

    /// <summary>Null only if KSP's own dv component was non-finite this tick — see <see cref="DvRadial"/>'s doc comment.</summary>
    public double? DvPrograde { get; set; }

    /// <summary>Null only if KSP's own dv magnitude was non-finite this tick — see <see cref="DvRadial"/>'s doc comment.</summary>
    public double? DvTotal { get; set; }
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

    public PayloadMeta Meta { get; set; } = new();
}
