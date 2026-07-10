#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One stage in the <c>dv.stages</c> channel payload — a single
/// ΔV-producing stage of the active vessel, straight from KSP's STOCK
/// <c>VesselDeltaV</c> stage simulation (the same numbers the in-game ΔV
/// app shows — atmosphere/ISP/crossfeed/staging all handled by the game, no
/// rocket-equation hand-rolling). The channel payload is a BARE ARRAY of these
/// (<c>StageDeltaVEntry[]</c>) or <c>null</c> — never a wrapper object, and
/// never an empty-vs-absent distinction beyond "the whole array is
/// <c>null</c> when the stock sim isn't ready / there is no active vessel"
/// (see <c>Sitrep.Host.StageDeltaVViewProvider.BuildStages</c>). Uses
/// <c>VesselDeltaV.OperatingStageInfo</c> — the stages that actually have ΔV,
/// mirroring the in-game app — not the raw stage list.
///
/// <para><b>Typing-only mirror.</b> This type reproduces, field-for-field, the
/// exact serialized shape <c>StageDeltaVViewProvider.BuildStages</c> already
/// emits (same names, same camelCase wire keys via
/// <c>RtConfig.CamelCaseForProperties</c>, same units). It is NOT serialized
/// itself — the wire is written by <c>JsonWriter</c> walking the provider's
/// dictionary — so adding it changes no bytes. Every field is nullable because
/// each is read through <c>SnapshotDict.Get*</c>, which yields <c>null</c>
/// (not a sentinel) whenever the raw value is absent or non-finite — so a
/// stage the sim reports as <c>NaN</c>/<c>Infinity</c> becomes <c>null</c>.</para>
///
/// <para>Deliberately carries NO <c>Meta</c> field: like the
/// <c>system.*</c> family, this is a hand-built snapshot payload with no
/// per-payload provenance — its <c>Meta</c> rides the envelope
/// (<c>StreamData.Meta</c>), never the payload body.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("dv.stages", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class StageDeltaVEntry
{
    /// <summary><c>DeltaVStageInfo.stage</c> — the stage number this entry describes.</summary>
    public int? Stage { get; set; }

    /// <summary><c>DeltaVStageInfo.deltaVinVac</c> — stage ΔV in vacuum (m/s).</summary>
    public double? DvVac { get; set; }

    /// <summary><c>DeltaVStageInfo.deltaVatASL</c> — stage ΔV at sea level (m/s).</summary>
    public double? DvAsl { get; set; }

    /// <summary><c>DeltaVStageInfo.deltaVActual</c> — stage ΔV at the current situation (m/s).</summary>
    public double? DvActual { get; set; }

    /// <summary><c>DeltaVStageInfo.stageBurnTime</c> — full-throttle burn time for the stage (s).</summary>
    public double? BurnTime { get; set; }

    /// <summary><c>DeltaVStageInfo.TWRVac</c> — thrust-to-weight ratio in vacuum.</summary>
    public double? TwrVac { get; set; }

    /// <summary><c>DeltaVStageInfo.TWRASL</c> — thrust-to-weight ratio at sea level.</summary>
    public double? TwrAsl { get; set; }

    /// <summary><c>DeltaVStageInfo.TWRActual</c> — thrust-to-weight ratio at the current situation.</summary>
    public double? TwrActual { get; set; }

    /// <summary><c>DeltaVStageInfo.thrustVac</c> — stage thrust in vacuum (kN).</summary>
    public double? ThrustVac { get; set; }

    /// <summary><c>DeltaVStageInfo.thrustASL</c> — stage thrust at sea level (kN).</summary>
    public double? ThrustAsl { get; set; }

    /// <summary><c>DeltaVStageInfo.thrustActual</c> — stage thrust at the current situation (kN).</summary>
    public double? ThrustActual { get; set; }

    /// <summary><c>DeltaVStageInfo.startMass</c> — stage start mass (tonnes).</summary>
    public double? StartMass { get; set; }

    /// <summary><c>DeltaVStageInfo.endMass</c> — stage end (burnout) mass (tonnes).</summary>
    public double? EndMass { get; set; }

    /// <summary><c>DeltaVStageInfo.dryMass</c> — stage dry mass (tonnes).</summary>
    public double? DryMass { get; set; }

    /// <summary><c>DeltaVStageInfo.fuelMass</c> — stage fuel mass (tonnes).</summary>
    public double? FuelMass { get; set; }
}

/// <summary>
/// The <c>dv.summary</c> channel payload — the whole-vessel ΔV rollup KSP's
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
#if NETSTANDARD2_0
[TsInterface]
#endif
public class StageDeltaVSummary
{
    /// <summary><c>VesselDeltaV.OperatingStageInfo.Count</c> — the number of ΔV-producing stages.</summary>
    public int? StageCount { get; set; }

    /// <summary><c>VesselDeltaV.TotalDeltaVVac</c> — total vessel ΔV in vacuum (m/s).</summary>
    public double? TotalDvVac { get; set; }

    /// <summary><c>VesselDeltaV.TotalDeltaVASL</c> — total vessel ΔV at sea level (m/s).</summary>
    public double? TotalDvAsl { get; set; }

    /// <summary><c>VesselDeltaV.TotalDeltaVActual</c> — total vessel ΔV at the current situation (m/s).</summary>
    public double? TotalDvActual { get; set; }

    /// <summary><c>VesselDeltaV.TotalBurnTime</c> — total full-throttle burn time across all stages (s).</summary>
    public double? TotalBurnTime { get; set; }
}
