#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// The <c>career.status</c> channel payload: the KSC/career-mode snapshot
/// (economy, facilities, contracts, strategies, tech). The whole payload is
/// <c>null</c> in the SANDBOX / no-career case (no <c>"career"</c> group in
/// the snapshot at all: see <c>Sitrep.Host.CareerViewProvider.BuildCareer</c>);
/// a non-null payload with any/all sub-groups themselves <c>null</c> is the
/// "career mode, that group genuinely unavailable this tick" case. All five
/// top-level keys are ALWAYS emitted (each nullable), never omitted.
///
/// <para><b>Typing-only mirror (P0.5).</b> This type reproduces, field for
/// field, the EXACT serialized shape <c>CareerViewProvider.BuildCareer</c>
/// already emits: same names, same camelCase wire keys (via
/// <c>RtConfig.CamelCaseForProperties</c>), same types, same units. It is NOT
/// serialized itself: the wire bytes are written by
/// <c>Sitrep.Core.Serialization.JsonWriter</c> walking the provider's live
/// <c>Dictionary&lt;string, object?&gt;</c> tree, so adding this type changes
/// no bytes. The hierarchical-naming / unit cleanup is a later phase (P5) and
/// is deliberately NOT done here. Nullability mirrors <c>SnapshotDict.Get*</c>
/// (null on absence / non-finite, never a sentinel); the two counts
/// (<see cref="CareerStrategies.ActiveCount"/>, <see cref="CareerTech.UnlockedCount"/>)
/// are the only non-nullable numbers because the provider defaults them to a
/// list count rather than emitting null.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("career.status")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerStatus
{
    public CareerEconomy? Economy { get; set; }

    /// <summary>
    /// DYNAMIC-KEY MAP keyed by <c>SpaceCenterFacility</c> name (e.g.
    /// <c>"LaunchPad"</c>, <c>"VehicleAssemblyBuilding"</c>): not a fixed
    /// record. Modelled as a <c>Dictionary&lt;string, CareerFacility&gt;</c>
    /// so codegen emits a TS index signature (<c>{ [k]: CareerFacility }</c>),
    /// matching how <c>VesselResources.Resources</c> is done.
    /// </summary>
    public Dictionary<string, CareerFacility>? Facilities { get; set; }

    public CareerContracts? Contracts { get; set; }

    public CareerStrategies? Strategies { get; set; }

    public CareerTech? Tech { get; set; }
}

/// <summary>Economy sub-group of <see cref="CareerStatus"/>: funds/reputation/science, each null when absent.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerEconomy
{
    [SitrepUnit(Units.Funds)]
    public double? Funds { get; set; }

    [SitrepUnit(Units.Reputation)]
    public double? Reputation { get; set; }

    [SitrepUnit(Units.Science)]
    public double? Science { get; set; }
}

/// <summary>
/// One facility entry in <see cref="CareerStatus.Facilities"/>. All three
/// fields share one live-facility gate on the KSP side, so they are null
/// together when the facility isn't queryable in the current scene.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerFacility
{
    /// <summary>
    /// Which facility this entry is, as KSP's <c>SpaceCenterFacility</c>
    /// ORDINAL, typed to <see cref="KspSpaceCenterFacility"/>.
    ///
    /// <para><c>career.status.facilities</c> is keyed by the enum NAME and stays
    /// that way: rekeying the map to a number would be a breaking retype and
    /// would change the shape of every consumer's key walk. So the identity
    /// rides INSIDE the entry instead, and a client no longer has to recognise
    /// the key it arrived under. It used to have to: the key was matched against
    /// a hand-written nine-entry name table, and a facility whose name missed
    /// was skipped outright, so it simply vanished from the display.</para>
    ///
    /// <para><c>null</c> from a producer that predates this field.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public KspSpaceCenterFacility? FacilityOrdinal { get; set; }

    [SitrepUnit(Units.Count)]
    public int? CurrentTier { get; set; }

    [SitrepUnit(Units.Count)]
    public int? MaxTier { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? UpgradeCost { get; set; }
}

/// <summary>Contracts sub-group of <see cref="CareerStatus"/>. All three lists are always present (empty, never null).</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerContracts
{
    public List<CareerContract> Active { get; set; } = new();

    public List<CareerContract> Offered { get; set; } = new();

    /// <summary>
    /// BOUNDED recently-completed list: the last N (currently 10)
    /// <c>State.Completed</c> contracts from
    /// <c>ContractSystem.Instance.ContractsFinished</c>, sorted newest-first
    /// by <c>Contract.DateFinished</c> (see
    /// <c>Gonogo.KSP.KspHost.BuildCareerContracts</c>). Same
    /// <see cref="CareerContract"/> element shape as <see cref="Active"/> /
    /// <see cref="Offered"/>: no extra fields; <c>State</c> is always
    /// <c>"Completed"</c> here. Rides <c>career.status</c> (TrueNow).
    /// </summary>
    public List<CareerContract> CompletedRecent { get; set; } = new();
}

/// <summary>One contract in <see cref="CareerContracts.Active"/> / <see cref="CareerContracts.Offered"/>.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerContract
{
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Agent { get; set; }

    [SitrepUnit(Units.Text)]
    public string? State { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? FundsAdvance { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? FundsCompletion { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? FundsFailure { get; set; }

    [SitrepUnit(Units.Science)]
    public double? ScienceCompletion { get; set; }

    [SitrepUnit(Units.Reputation)]
    public double? ReputationCompletion { get; set; }

    [SitrepUnit(Units.Reputation)]
    public double? ReputationFailure { get; set; }

    [SitrepUnit(Units.UniversalTime)]
    public double? DateAccepted { get; set; }

    [SitrepUnit(Units.UniversalTime)]
    public double? DateDeadline { get; set; }

    [SitrepUnit(Units.UniversalTime)]
    public double? DateExpire { get; set; }

    public List<CareerContractParameter> Parameters { get; set; } = new();
}

/// <summary>One parameter (objective) of a <see cref="CareerContract"/>.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerContractParameter
{
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>
    /// <c>Contracts.ParameterState</c>'s enum NAME
    /// (<c>Incomplete</c>/<c>Complete</c>/<c>Failed</c>): a display label.
    /// <see cref="StateOrdinal"/> is the field to branch on.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? State { get; set; }

    /// <summary>
    /// <see cref="State"/>'s KSP ORDINAL, typed to
    /// <see cref="KspParameterState"/>.
    ///
    /// <para>Whether an objective reads as DONE was decided by comparing
    /// <see cref="State"/> against <c>"Complete"</c>, and an unrecognised
    /// spelling collapsed onto <c>Incomplete</c>. That is the pessimistic arm:
    /// a completed objective showing as outstanding, and a contract-parameter
    /// ALARM set on "Complete" that simply never fires. An alarm that never
    /// fires is the failure mode this whole exercise is about.</para>
    ///
    /// <para><c>null</c> when the capture carried no state, which is a third
    /// answer and must not be read as either arm.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public KspParameterState? StateOrdinal { get; set; }
}

/// <summary>
/// Strategies sub-group of <see cref="CareerStatus"/>.
/// <see cref="ActiveCount"/> is NON-nullable, the provider defaults it to
/// <c>Active.Count</c> when the raw value is absent.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerStrategies
{
    public List<CareerStrategy> Active { get; set; } = new();

    public List<CareerStrategy> All { get; set; } = new();

    [SitrepUnit(Units.Count)]
    public int ActiveCount { get; set; }
}

/// <summary>One strategy in <see cref="CareerStrategies.Active"/> / <see cref="CareerStrategies.All"/>.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerStrategy
{
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Description { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Department { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? IsActive { get; set; }

    [SitrepUnit(Units.Ratio)]
    public double? Factor { get; set; }

    [SitrepUnit(Units.UniversalTime)]
    public double? DateActivated { get; set; }

    [SitrepUnit(Units.Reputation)]
    public double? RequiredReputation { get; set; }

    [SitrepUnit(Units.Funds)]
    public double? InitialCostFunds { get; set; }

    [SitrepUnit(Units.Science)]
    public double? InitialCostScience { get; set; }

    [SitrepUnit(Units.Reputation)]
    public double? InitialCostReputation { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? HasFactorSlider { get; set; }

    [SitrepUnit(Units.Ratio)]
    public double? FactorSliderDefault { get; set; }

    [SitrepUnit(Units.Count)]
    public int? FactorSliderSteps { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? CanActivate { get; set; }

    [SitrepUnit(Units.Text)]
    public string? ActivateBlockedReason { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? CanDeactivate { get; set; }

    [SitrepUnit(Units.Text)]
    public string? DeactivateBlockedReason { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Effect { get; set; }
}

/// <summary>
/// Tech sub-group of <see cref="CareerStatus"/>.
/// <see cref="UnlockedCount"/> is NON-nullable, the provider defaults it to
/// <c>UnlockedIds.Count</c> when the raw value is absent.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerTech
{
    [SitrepUnit(Units.Count)]
    public int UnlockedCount { get; set; }

    [SitrepUnit(Units.Id)]
    public List<string> UnlockedIds { get; set; } = new();

    public List<CareerTechNode> Nodes { get; set; } = new();
}

/// <summary>One node in <see cref="CareerTech.Nodes"/>.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerTechNode
{
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    [SitrepUnit(Units.Science)]
    public double? ScienceCost { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Unlocked { get; set; }

    [SitrepUnit(Units.Id)]
    public List<string> Parents { get; set; } = new();
}
