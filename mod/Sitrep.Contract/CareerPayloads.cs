#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// The <c>career.status</c> channel payload: the KSC and career-mode snapshot,
/// in five groups (economy, facilities, contracts, strategies, tech).
///
/// <para><b>Three states, and they mean different things.</b> The whole payload
/// is <c>null</c> in SANDBOX, where there is no career at all. A non-null
/// payload with a sub-group <c>null</c> means career mode is running and that
/// group is genuinely unavailable this tick. All five top-level keys are ALWAYS
/// present, each nullable, never omitted, so a missing key is a protocol error
/// rather than an absent group.</para>
///
/// <para>Every number is nullable and <c>null</c> is never a sentinel: a field
/// is <c>null</c> whenever the raw value is absent or non-finite. The two counts
/// (<see cref="CareerStrategies.ActiveCount"/>,
/// <see cref="CareerTech.UnlockedCount"/>) are the only non-nullable numbers,
/// because an empty list counts as zero rather than as unknown.</para>
///
/// <internal>
/// <para><b>Typing-only mirror (P0.5).</b> This type reproduces, field for
/// field, the EXACT serialized shape
/// <c>Sitrep.Host.CareerViewProvider.BuildCareer</c> already emits: same names,
/// same camelCase wire keys (via <c>RtConfig.CamelCaseForProperties</c>), same
/// types, same units. It is NOT serialized itself: the wire bytes are written by
/// <c>Sitrep.Core.Serialization.JsonWriter</c> walking the provider's live
/// <c>Dictionary&lt;string, object?&gt;</c> tree, so adding this type changed no
/// bytes. The sandbox case is the absence of a <c>"career"</c> group in the
/// snapshot. Nullability is <c>SnapshotDict.Get*</c>'s rule, not a per-field
/// choice.</para>
///
/// <para>The hierarchical-naming and unit cleanup is a later phase (P5) and is
/// deliberately NOT done here.</para>
/// </internal>
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
    /// <c>"LaunchPad"</c>, <c>"VehicleAssemblyBuilding"</c>): not a fixed record,
    /// so enumerate the keys rather than reaching for one you expect to be there.
    /// <internal>
    /// Modelled as a <c>Dictionary&lt;string, CareerFacility&gt;</c> so codegen
    /// emits a TS index signature, matching how <c>VesselResources.Resources</c>
    /// is done.
    /// </internal>
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

    /// <summary>
    /// The stock reputation field, unchanged. Under a career overhaul it is the
    /// most consequential number in the save (it IS the income) and the value was
    /// never wrong: what was missing is the context below, which is why that
    /// arrived as an elected interpretation rather than as a replacement here.
    /// </summary>
    [SitrepUnit(Units.Reputation)]
    public double? Reputation { get; set; }

    [SitrepUnit(Units.Science)]
    public double? Science { get; set; }

    /// <summary>
    /// Which money model answered the four fields below, e.g. <c>"stock"</c>.
    /// Provenance only: a client reads the interpretation, never branches on who
    /// produced it.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? EconomyModel { get; set; }

    /// <summary>
    /// Reputation lost per day at the current reputation. Zero on stock, which
    /// genuinely has no decay, and that zero is a statement rather than a
    /// placeholder.
    /// </summary>
    [SitrepUnit(Units.ReputationPerDay)]
    public double? ReputationDecayPerDay { get; set; }

    /// <summary>Funding the current reputation earns, per day. Zero on stock.</summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? SubsidyPerDay { get; set; }

    /// <summary>The subsidy at zero reputation: the floor nothing takes away.</summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? SubsidyMinPerDay { get; set; }

    /// <summary>
    /// The subsidy reputation cannot beat. With the minimum it says how much of
    /// the range the current reputation has bought, which is what turns a bare
    /// reputation number into something an operator can act on.
    /// </summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? SubsidyMaxPerDay { get; set; }

    /// <summary>
    /// Total ongoing cost per day. This is why <see cref="Funds"/> is the right
    /// balance and the wrong affordability test under an overhaul: a balance that
    /// covers a purchase today may not cover it plus next month's salaries.
    /// </summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? UpkeepPerDay { get; set; }

    /// <summary>
    /// Where the upkeep goes: the parts <see cref="UpkeepPerDay"/> is made of,
    /// and they sum to it. ABSENT on stock, which has no per-source model at all:
    /// seven zeros would claim stock levies seven kinds of nothing, where the
    /// truth is that it levies none of them.
    /// </summary>
    /// <remarks>
    /// Also absent when the model can state its costs but cannot price them, in
    /// which case <see cref="UpkeepBeforeModifiers"/> stands alone. A set that
    /// did not add up to the total beside it would be worse than no set: a reader
    /// has no way to tell which of the two lied.
    /// </remarks>
    public CareerUpkeep? Upkeep { get; set; }

    /// <summary>
    /// The same sources, priced BEFORE whatever the model does to them at
    /// transaction time: leaders, strategies, standing discounts. ABSENT when the
    /// model applies nothing, so the difference between this and
    /// <see cref="Upkeep"/> is what the career's current arrangements are worth.
    /// </summary>
    public CareerUpkeep? UpkeepBeforeModifiers { get; set; }

    /// <summary>
    /// A prepaid allowance the elected money model spends BEFORE <see cref="Funds"/>
    /// on the purchases it covers. In funds, because that is what it discounts.
    /// ABSENT on stock, which has no such pool.
    /// </summary>
    /// <remarks>
    /// The second reason <see cref="Funds"/> alone is not an affordability test:
    /// where this exists, part of a price is already paid. It is a BALANCE and not
    /// a per-purchase answer, so a surface that offers such a purchase shows this
    /// and the funds balance together rather than deriving the split itself.
    /// </remarks>
    [SitrepUnit(Units.Funds)]
    public double? UnlockCredit { get; set; }
}

/// <summary>
/// Ongoing cost by source, per day, from the elected economy model. Every member
/// is absent when that model does not have the concept, never zero: an
/// unmodelled source and a source costing nothing are different facts.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerUpkeep
{
    /// <summary>Buildings: the standing cost of having a space centre at all.</summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? Facilities { get; set; }

    /// <summary>Launch complexes and their pads, which cost whether or not anything is building.</summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? LaunchComplexes { get; set; }

    /// <summary>Researcher salaries, which an idle research queue does not stop.</summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? ResearchSalary { get; set; }

    /// <summary>Crew training in progress.</summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? Training { get; set; }

    /// <summary>Standing crew costs: everyone on the roster, flying or not.</summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? CrewBase { get; set; }

    /// <summary>The extra a crew in flight costs over a crew on the ground.</summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? CrewInFlight { get; set; }

    /// <summary>Engineer salaries on the integration teams.</summary>
    [SitrepUnit(Units.FundsPerDay)]
    public double? IntegrationSalary { get; set; }
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

    /// <summary>
    /// The node's flavour line, as the tech tree itself writes it ("How hard
    /// can Rocket Science be anyway?").
    ///
    /// <para>It comes from the tree's own config rather than from
    /// <c>RDTech</c>, whose <c>description</c> field only exists while the R&amp;D
    /// Building scene is open. A tech tree a mod has replaced (RP-1) is read
    /// the same way, so this is the node's description in whatever tree the
    /// save is playing.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Description { get; set; }

    [SitrepUnit(Units.Science)]
    public double? ScienceCost { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool? Unlocked { get; set; }

    [SitrepUnit(Units.Id)]
    public List<string> Parents { get; set; } = new();
}
