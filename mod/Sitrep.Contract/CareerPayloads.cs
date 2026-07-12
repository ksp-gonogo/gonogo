#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// The <c>career.status</c> channel payload — the KSC/career-mode snapshot
/// (economy, facilities, contracts, strategies, tech). The whole payload is
/// <c>null</c> in the SANDBOX / no-career case (no <c>"career"</c> group in
/// the snapshot at all — see <c>Sitrep.Host.CareerViewProvider.BuildCareer</c>);
/// a non-null payload with any/all sub-groups themselves <c>null</c> is the
/// "career mode, that group genuinely unavailable this tick" case. All five
/// top-level keys are ALWAYS emitted (each nullable), never omitted.
///
/// <para><b>Typing-only mirror (P0.5).</b> This type reproduces, field for
/// field, the EXACT serialized shape <c>CareerViewProvider.BuildCareer</c>
/// already emits — same names, same camelCase wire keys (via
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
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerStatus
{
    public CareerEconomy? Economy { get; set; }

    /// <summary>
    /// DYNAMIC-KEY MAP keyed by <c>SpaceCenterFacility</c> name (e.g.
    /// <c>"LaunchPad"</c>, <c>"VehicleAssemblyBuilding"</c>) — not a fixed
    /// record. Modelled as a <c>Dictionary&lt;string, CareerFacility&gt;</c>
    /// so codegen emits a TS index signature (<c>{ [k]: CareerFacility }</c>),
    /// matching how <c>VesselResources.Resources</c> is done.
    /// </summary>
    public Dictionary<string, CareerFacility>? Facilities { get; set; }

    public CareerContracts? Contracts { get; set; }

    public CareerStrategies? Strategies { get; set; }

    public CareerTech? Tech { get; set; }
}

/// <summary>Economy sub-group of <see cref="CareerStatus"/> — funds/reputation/science, each null when absent.</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerEconomy
{
    public double? Funds { get; set; }

    public double? Reputation { get; set; }

    public double? Science { get; set; }
}

/// <summary>
/// One facility entry in <see cref="CareerStatus.Facilities"/>. All three
/// fields share one live-facility gate on the KSP side, so they are null
/// together when the facility isn't queryable in the current scene.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerFacility
{
    public int? CurrentTier { get; set; }

    public int? MaxTier { get; set; }

    public double? UpgradeCost { get; set; }
}

/// <summary>Contracts sub-group of <see cref="CareerStatus"/>. All three lists are always present (empty, never null).</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerContracts
{
    public List<CareerContract> Active { get; set; } = new();

    public List<CareerContract> Offered { get; set; } = new();

    /// <summary>
    /// BOUNDED recently-completed list — the last N (currently 10)
    /// <c>State.Completed</c> contracts from
    /// <c>ContractSystem.Instance.ContractsFinished</c>, sorted newest-first
    /// by <c>Contract.DateFinished</c> (see
    /// <c>Gonogo.KSP.KspHost.BuildCareerContracts</c>). Same
    /// <see cref="CareerContract"/> element shape as <see cref="Active"/> /
    /// <see cref="Offered"/> — no extra fields; <c>State</c> is always
    /// <c>"Completed"</c> here. Rides <c>career.status</c> (TrueNow).
    /// </summary>
    public List<CareerContract> CompletedRecent { get; set; } = new();
}

/// <summary>One contract in <see cref="CareerContracts.Active"/> / <see cref="CareerContracts.Offered"/>.</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerContract
{
    public string? Id { get; set; }

    public string? Title { get; set; }

    public string? Agent { get; set; }

    public string? State { get; set; }

    public double? FundsAdvance { get; set; }

    public double? FundsCompletion { get; set; }

    public double? FundsFailure { get; set; }

    public double? ScienceCompletion { get; set; }

    public double? ReputationCompletion { get; set; }

    public double? ReputationFailure { get; set; }

    public double? DateAccepted { get; set; }

    public double? DateDeadline { get; set; }

    public double? DateExpire { get; set; }

    public List<CareerContractParameter> Parameters { get; set; } = new();
}

/// <summary>One parameter (objective) of a <see cref="CareerContract"/>.</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerContractParameter
{
    public string? Title { get; set; }

    public string? State { get; set; }
}

/// <summary>
/// Strategies sub-group of <see cref="CareerStatus"/>.
/// <see cref="ActiveCount"/> is NON-nullable — the provider defaults it to
/// <c>Active.Count</c> when the raw value is absent.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerStrategies
{
    public List<CareerStrategy> Active { get; set; } = new();

    public List<CareerStrategy> All { get; set; } = new();

    public int ActiveCount { get; set; }
}

/// <summary>One strategy in <see cref="CareerStrategies.Active"/> / <see cref="CareerStrategies.All"/>.</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerStrategy
{
    public string? Id { get; set; }

    public string? Title { get; set; }

    public string? Description { get; set; }

    public string? Department { get; set; }

    public bool? IsActive { get; set; }

    public double? Factor { get; set; }

    public double? DateActivated { get; set; }

    public double? RequiredReputation { get; set; }

    public double? InitialCostFunds { get; set; }

    public double? InitialCostScience { get; set; }

    public double? InitialCostReputation { get; set; }

    public bool? HasFactorSlider { get; set; }

    public double? FactorSliderDefault { get; set; }

    public int? FactorSliderSteps { get; set; }

    public bool? CanActivate { get; set; }

    public string? ActivateBlockedReason { get; set; }

    public bool? CanDeactivate { get; set; }

    public string? DeactivateBlockedReason { get; set; }

    public string? Effect { get; set; }
}

/// <summary>
/// Tech sub-group of <see cref="CareerStatus"/>.
/// <see cref="UnlockedCount"/> is NON-nullable — the provider defaults it to
/// <c>UnlockedIds.Count</c> when the raw value is absent.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerTech
{
    public int UnlockedCount { get; set; }

    public List<string> UnlockedIds { get; set; } = new();

    public List<CareerTechNode> Nodes { get; set; } = new();
}

/// <summary>One node in <see cref="CareerTech.Nodes"/>.</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerTechNode
{
    public string? Id { get; set; }

    public string? Title { get; set; }

    public double? ScienceCost { get; set; }

    public bool? Unlocked { get; set; }

    public List<string> Parents { get; set; } = new();
}
