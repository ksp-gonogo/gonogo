#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One ΔV-producing stage of the active vessel, straight from KSP's STOCK
/// <c>VesselDeltaV</c> stage simulation: the same numbers the in-game ΔV app
/// shows, with atmosphere, ISP, crossfeed and staging all handled by the game.
/// Only the stages that actually produce ΔV appear, the same set the in-game app
/// lists rather than the raw stage list, so stage numbers can be sparse.
///
/// <para>The <c>dv.stages</c> payload is a BARE ARRAY of these or <c>null</c>:
/// never a wrapper object. The whole array is <c>null</c> when the stock
/// simulation is not ready or there is no active vessel.</para>
///
/// <para><b>Every field is nullable, and <c>null</c> is never a sentinel.</b> A
/// field is <c>null</c> whenever the raw value is absent OR non-finite, so a
/// stage the simulation reports as <c>NaN</c> or <c>Infinity</c> reaches you as
/// <c>null</c> rather than as a number you would have to test.</para>
///
/// <para>Carries no <c>meta</c> of its own: provenance rides the envelope
/// (<c>StreamData.Meta</c>), never the payload body.</para>
///
/// <internal>
/// <para><b>Typing-only mirror.</b> This type reproduces, field-for-field, the
/// exact serialized shape <c>Sitrep.Host.StageDeltaVViewProvider.BuildStages</c>
/// already emits (same names, same camelCase wire keys via
/// <c>RtConfig.CamelCaseForProperties</c>, same units). It is NOT serialized
/// itself: the wire is written by <c>JsonWriter</c> walking the provider's
/// dictionary, so adding it changed no bytes. The nullability rule above is
/// <c>SnapshotDict.Get*</c>'s, not a choice made per field. Source is
/// <c>VesselDeltaV.OperatingStageInfo</c>.</para>
///
/// <para>Deliberately carries no <c>Meta</c> field: like the <c>system.*</c>
/// family, this is a hand-built snapshot payload with no per-payload
/// provenance.</para>
/// </internal>
/// </summary>
[SitrepContract]
[SitrepTopic("dv.stages", isArray: true)]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class StageDeltaVEntry
{
    /// <summary><c>DeltaVStageInfo.stage</c>: the stage number this entry describes.</summary>
    [SitrepUnit(Units.Id)]
    public int? Stage { get; set; }

    /// <summary><c>DeltaVStageInfo.deltaVinVac</c>: stage ΔV in vacuum (m/s).</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DvVac { get; set; }

    /// <summary><c>DeltaVStageInfo.deltaVatASL</c>: stage ΔV at sea level (m/s).</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DvAsl { get; set; }

    /// <summary><c>DeltaVStageInfo.deltaVActual</c>: stage ΔV at the current situation (m/s).</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DvActual { get; set; }

    /// <summary><c>DeltaVStageInfo.stageBurnTime</c>: full-throttle burn time for the stage (s).</summary>
    [SitrepUnit(Units.Seconds)]
    public double? BurnTime { get; set; }

    /// <summary><c>DeltaVStageInfo.TWRVac</c>: thrust-to-weight ratio in vacuum.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? TwrVac { get; set; }

    /// <summary><c>DeltaVStageInfo.TWRASL</c>: thrust-to-weight ratio at sea level.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? TwrAsl { get; set; }

    /// <summary><c>DeltaVStageInfo.TWRActual</c>: thrust-to-weight ratio at the current situation.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? TwrActual { get; set; }

    /// <summary><c>DeltaVStageInfo.thrustVac</c>: stage thrust in vacuum (kN).</summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? ThrustVac { get; set; }

    /// <summary><c>DeltaVStageInfo.thrustASL</c>: stage thrust at sea level (kN).</summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? ThrustAsl { get; set; }

    /// <summary><c>DeltaVStageInfo.thrustActual</c>: stage thrust at the current situation (kN).</summary>
    [SitrepUnit(Units.Kilonewtons)]
    public double? ThrustActual { get; set; }

    /// <summary><c>DeltaVStageInfo.startMass</c>: stage start mass (tonnes).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? StartMass { get; set; }

    /// <summary><c>DeltaVStageInfo.endMass</c>: stage end (burnout) mass (tonnes).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? EndMass { get; set; }

    /// <summary><c>DeltaVStageInfo.dryMass</c>: stage dry mass (tonnes).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? DryMass { get; set; }

    /// <summary><c>DeltaVStageInfo.fuelMass</c>: stage fuel mass (tonnes).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? FuelMass { get; set; }

    /// <summary>
    /// Per-resource current/max amounts for the parts active IN THIS STAGE,
    /// the old <c>r.resourceCurrent[X]</c>/<c>r.resourceCurrentMax[X]</c>
    /// pair (as opposed to <c>vessel.resources</c>'s vessel-WIDE totals).
    /// <c>DeltaVStageInfo</c> itself has no per-resource field (only aggregate
    /// dry/fuel mass), so this is built by walking every part's
    /// <c>DeltaVPartInfo.stageFuelMass</c> snapshot for this stage number and
    /// summing by resource name (<c>Gonogo.KSP.KspHost.BuildStageResources</c>).
    /// Never null: an empty map is a real "no tracked resources active in
    /// this stage" reading, distinct from the whole stage entry being absent.
    /// </summary>
    public Dictionary<string, ResourceAmount>? Resources { get; set; }
}

/// <summary>
/// The <c>dv.summary</c> channel payload: the whole-vessel ΔV rollup KSP's
/// stock <c>VesselDeltaV</c> exposes alongside the per-stage
/// <see cref="StageDeltaVEntry"/> list: the ΔV-producing stage count plus the
/// vacuum / sea-level / current totals and total burn time. A SINGLE WRAPPER
/// OBJECT (or <c>null</c> when the stock sim isn't ready / there is no active
/// vessel), so the Topic tag sits on this type directly with the default
/// <c>IsArray = false</c>.
///
/// <para><b>Typing-only mirror</b> of
/// <c>StageDeltaVViewProvider.BuildSummary</c>, same convention as
/// <see cref="StageDeltaVEntry"/>: hand-built by the provider, never
/// serialized itself, no per-payload <c>Meta</c> (it rides the envelope).</para>
/// </summary>
[SitrepContract]
[SitrepTopic("dv.summary")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class StageDeltaVSummary
{
    /// <summary><c>VesselDeltaV.OperatingStageInfo.Count</c>: the number of ΔV-producing stages.</summary>
    [SitrepUnit(Units.Count)]
    public int? StageCount { get; set; }

    /// <summary><c>VesselDeltaV.TotalDeltaVVac</c>: total vessel ΔV in vacuum (m/s).</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? TotalDvVac { get; set; }

    /// <summary><c>VesselDeltaV.TotalDeltaVASL</c>: total vessel ΔV at sea level (m/s).</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? TotalDvAsl { get; set; }

    /// <summary><c>VesselDeltaV.TotalDeltaVActual</c>: total vessel ΔV at the current situation (m/s).</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? TotalDvActual { get; set; }

    /// <summary><c>VesselDeltaV.TotalBurnTime</c>: total full-throttle burn time across all stages (s).</summary>
    [SitrepUnit(Units.Seconds)]
    public double? TotalBurnTime { get; set; }
}
