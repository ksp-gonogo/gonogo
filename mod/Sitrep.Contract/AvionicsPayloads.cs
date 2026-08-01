#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>avionics.status</c> channel: RP-1 controllable-mass ascent go/no-go.
/// RP-1 gates vehicle control by an avionics unit's tonnage limit: if the
/// vessel's mass exceeds the controllable mass of its active avionics, the craft
/// cannot be steered during ascent. Produced by <c>GonogoAvionicsUplink</c>,
/// which reflects the RP-1 <c>RP0.ModuleAvionics</c> /
/// <c>RP0.ProceduralAvionics.ModuleProceduralAvionics</c> live
/// <c>CurrentMassLimit</c> (the same value <c>RP0.ControlLockerUtils.ShouldLock</c>
/// compares) and pairs it with the vessel's stock total mass.
///
/// <para>A TS-shape-only typing/codegen marker: the uplink hand-builds the dict
/// and <c>JsonWriter</c> walks that live tree, so this POCO never serializes.
/// Classified <c>DelayRole.Delayed</c> (a per-vessel telemetry fact, subject to
/// the reveal-gate); the bare <c>avionics.available</c> presence primitive is
/// <c>DelayRole.TrueNow</c> and declared client-side.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("avionics.status")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public sealed class AvionicsStatus
{
    /// <summary>True when an avionics unit is present + active on the vessel.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? AvionicsActive { get; set; }

    /// <summary>Controllable-mass limit of the active avionics (tonnes), the MAX
    /// across parts of each part's summed <c>CurrentMassLimit</c>, matching
    /// <c>ControlLockerUtils.ShouldLock</c>. Null when no avionics is present.</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? ControllableMassTons { get; set; }

    /// <summary>Vessel current total mass (tonnes).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? VesselMassTons { get; set; }

    /// <summary>Derived: VesselMassTons &lt;= ControllableMassTons (the ascent go/no-go).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Controllable { get; set; }
}
