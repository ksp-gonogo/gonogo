#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// The <c>career.status</c> channel payload: the KSC and career-mode snapshot,
/// in four groups (balances, contracts, strategies, tech). The space centre's
/// buildings are NOT here: they ride <see cref="CareerFacilities"/>, which can
/// be held on its own while this channel keeps arriving.
///
/// <para><b>Three states, and they mean different things.</b> The whole payload
/// is <c>null</c> in SANDBOX, where there is no career at all. A non-null
/// payload with a sub-group <c>null</c> means career mode is running and that
/// group is genuinely unavailable this tick. All four group keys are ALWAYS
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
/// <para>Typing-only mirror of the shape
/// <c>Sitrep.Host.CareerViewProvider.BuildCareer</c> emits: same names, same
/// camelCase wire keys (via <c>RtConfig.CamelCaseForProperties</c>), same
/// types, same units. The wire bytes are written by
/// <c>Sitrep.Contract.Serialization.JsonWriter</c> walking the provider's live
/// <c>Dictionary&lt;string, object?&gt;</c> tree. The sandbox case is the
/// absence of a <c>"career"</c> group in the snapshot. Nullability is
/// <c>SnapshotDict.Get*</c>'s rule, not a per-field choice.</para>
/// </internal>
/// </summary>
/// <category>Career</category>
[SitrepContract]
[SitrepTopic("career.status")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerStatus
{
    /// <summary>
    /// The career's balances (funds, reputation, science). <c>null</c> when none
    /// of the three could be read this tick.
    /// </summary>
    public CareerBalances? Balances { get; set; }

    /// <summary>
    /// Active, offered and recently completed contracts. <c>null</c> when KSP's
    /// contract system is not loaded this tick.
    /// </summary>
    public CareerContracts? Contracts { get; set; }

    /// <summary>
    /// The save's strategy roster and which strategies are active. <c>null</c>
    /// when KSP's strategy system is not loaded this tick.
    /// </summary>
    public CareerStrategies? Strategies { get; set; }

    /// <summary>
    /// The tech tree and which of it is unlocked. <c>null</c> when R&amp;D or
    /// the part list is not loaded this tick.
    /// </summary>
    public CareerTech? Tech { get; set; }

    /// <summary>
    /// Provenance, and always <c>"game"</c>: a career belongs to the save, not
    /// to anything flying, so switching vessels cannot change which one is being
    /// read.
    ///
    /// <para>A SCET alarm compares this stamp against the subject the alarm was
    /// set for, and refuses a reading that does not match. Without it a
    /// threshold on a career figure could be set and would then never come due,
    /// which an operator cannot tell apart from a condition that has not been
    /// met. <c>"game"</c> is the same token <see cref="ScetAlarm.Subject"/>
    /// carries for anything the whole simulation shares.</para>
    /// <internal>
    /// Stamped by <c>Sitrep.Host.CareerViewProvider.BuildCareer</c>.
    /// </internal>
    /// </summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>career.facilities</c> channel payload: the space centre's buildings,
/// each with the tier it stands at and the ladder it stands on.
///
/// <para><b>It arrives only while the game can report it, and stops
/// otherwise.</b> A facility's tier count and prices are readable from the
/// building objects, which KSP registers at the space centre, in the editor and
/// in flight. The tracking station reads the tier the save holds against the
/// ladder last read in one of those scenes. Where no ladder has been read there
/// is no reading to take, so this channel goes SILENT rather than reporting a
/// row of nulls. The last reading stands, dated, and the client marks it as
/// held: a whole channel can be held and said to be held, where a nullable
/// field on a channel that keeps ticking cannot.</para>
///
/// <para>A tier count does not change during a save, so a ladder held from an
/// earlier scene is still true. The tier standing on it can move, and does when
/// the player buys an upgrade, so both travel together and are dated together
/// rather than one being trusted further than the other.</para>
///
/// <internal>
/// <para>Kept off <c>CareerStatus</c> on purpose. A field subtopic takes its
/// parent channel's freshness outright (see the client's
/// <c>TimelineStore.sampleStatus</c>), and <c>career.status</c> keeps arriving
/// everywhere because the balances on it do, so a nested facilities group
/// would read as a CURRENT null, which is the one thing it is not.</para>
///
/// <para>The producer half is
/// <c>Sitrep.Host.CareerViewProvider.BuildFacilities</c> over
/// <c>Gonogo.KSP.KspHost.BuildCareerFacilities</c>, which returns null when no
/// facility resolved a live object. <c>ChannelDeclaration.NullIsUnreadable</c>
/// is what turns that null into silence instead of a tombstone.</para>
/// </internal>
/// </summary>
/// <category>Career</category>
[SitrepContract]
[SitrepTopic("career.facilities")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerFacilities
{
    /// <summary>
    /// DYNAMIC-KEY MAP keyed by <c>SpaceCenterFacility</c> name (e.g.
    /// <c>"LaunchPad"</c>, <c>"VehicleAssemblyBuilding"</c>): not a fixed record,
    /// so enumerate the keys rather than reaching for one you expect to be there.
    /// A facility the game cannot report is left out of the map. Never empty on
    /// the wire: the channel is absent instead.
    /// <internal>
    /// Modelled as a <c>Dictionary&lt;string, CareerFacility&gt;</c> so codegen
    /// emits a TS index signature, matching how <c>VesselResources.Resources</c>
    /// is done.
    /// </internal>
    /// </summary>
    public Dictionary<string, CareerFacility>? Facilities { get; set; }
}

/// <summary>
/// Balances sub-group of <see cref="CareerStatus"/>: the funds, reputation and
/// science balances, each <c>null</c> when unreadable.
/// </summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerBalances
{
    /// <summary>
    /// The career's funds balance, KSP's <c>Funding.Funds</c>. <c>null</c> when
    /// the funding module is not loaded.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? Funds { get; set; }

    /// <summary>
    /// The career's reputation, KSP's <c>Reputation.reputation</c>. <c>null</c>
    /// when the reputation module is not loaded.
    /// </summary>
    [SitrepUnit(Units.Reputation)]
    public double? Reputation { get; set; }

    /// <summary>
    /// The career's science balance, KSP's <c>ResearchAndDevelopment.Science</c>.
    /// <c>null</c> when the R&amp;D module is not loaded.
    /// </summary>
    [SitrepUnit(Units.Science)]
    public double? Science { get; set; }
}

/// <summary>
/// One facility entry in <see cref="CareerFacilities.Facilities"/>. A facility
/// the game cannot currently report is left out of the map rather than sent
/// with null fields, so an entry that is present always carries
/// <see cref="CurrentTier"/> and <see cref="MaxTier"/>.
/// </summary>
/// <category>Career</category>
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
    /// <para><see cref="CareerFacilities.Facilities"/> is keyed by the enum
    /// NAME. The identity also rides INSIDE the entry, so a client can identify
    /// the facility without recognising the key it arrived under.</para>
    ///
    /// <para><c>null</c> when the producer sent no ordinal.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public KspSpaceCenterFacility? FacilityOrdinal { get; set; }

    /// <summary>
    /// The tier the facility stands at, KSP's zero-based
    /// <c>UpgradeableFacility.FacilityLevel</c>: <c>0</c> is the first tier.
    /// Away from a scene that registers the building, this is the tier the save
    /// holds, read against the ladder last seen.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? CurrentTier { get; set; }

    /// <summary>
    /// The highest tier this facility can reach, KSP's zero-based
    /// <c>UpgradeableFacility.MaxLevel</c>. The facility is fully upgraded when
    /// <see cref="CurrentTier"/> equals it, and it has <c>MaxTier + 1</c> tiers.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? MaxTier { get; set; }

    /// <summary>
    /// The price of upgrading to the next tier, as KSP's
    /// <c>UpgradeableFacility.GetUpgradeCost</c> prices it (the save's funds
    /// difficulty multiplier applied). <c>null</c> when it could not be read.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? UpgradeCost { get; set; }
}

/// <summary>Contracts sub-group of <see cref="CareerStatus"/>. All three lists
/// are always present (empty, never null).</summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerContracts
{
    /// <summary>
    /// Contracts the career has accepted and not yet finished
    /// (<c>Contract.State.Active</c>).
    /// </summary>
    public List<CareerContract> Active { get; set; } = new();

    /// <summary>
    /// Contracts on offer and not yet accepted (<c>Contract.State.Offered</c>).
    /// </summary>
    public List<CareerContract> Offered { get; set; } = new();

    /// <summary> BOUNDED recently-completed list: the last N (currently 10)
    /// <c>State.Completed</c> contracts from
    /// <c>ContractSystem.Instance.ContractsFinished</c>, sorted newest-first by
    /// <c>Contract.DateFinished</c>. Failed, expired, cancelled and withdrawn
    /// contracts are not included. Same <see cref="CareerContract"/> element
    /// shape as <see cref="Active"/> / <see cref="Offered"/>: no extra fields;
    /// <c>State</c> is always <c>"Completed"</c> here.
    /// <internal>
    /// Filled by <c>Gonogo.KSP.KspHost.BuildCareerContracts</c>.
    /// </internal>
    /// </summary>
    public List<CareerContract> CompletedRecent { get; set; } = new();
}

/// <summary>One contract in <see cref="CareerContracts.Active"/>, <see
/// cref="CareerContracts.Offered"/> or <see
/// cref="CareerContracts.CompletedRecent"/>.</summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerContract
{
    /// <summary>
    /// KSP's <c>Contract.ContractID</c> as a decimal string: the id save files
    /// and other mods key contracts by, and stable for the contract's life. A
    /// string because the value routinely exceeds JavaScript's safe integer
    /// range.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>The contract's display title, <c>Contract.Title</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>
    /// The name of the agency offering the contract. <c>null</c> when the
    /// contract has no agent.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Agent { get; set; }

    /// <summary>
    /// KSP's <c>Contract.State</c> enum NAME, e.g. <c>"Active"</c>,
    /// <c>"Offered"</c> or <c>"Completed"</c>.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? State { get; set; }

    /// <summary>Funds paid when the contract is accepted.</summary>
    [SitrepUnit(Units.Funds)]
    public double? FundsAdvance { get; set; }

    /// <summary>Funds paid when the contract is completed.</summary>
    [SitrepUnit(Units.Funds)]
    public double? FundsCompletion { get; set; }

    /// <summary>Funds taken when the contract fails.</summary>
    [SitrepUnit(Units.Funds)]
    public double? FundsFailure { get; set; }

    /// <summary>Science awarded when the contract is completed.</summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceCompletion { get; set; }

    /// <summary>Reputation awarded when the contract is completed.</summary>
    [SitrepUnit(Units.Reputation)]
    public double? ReputationCompletion { get; set; }

    /// <summary>Reputation lost when the contract fails.</summary>
    [SitrepUnit(Units.Reputation)]
    public double? ReputationFailure { get; set; }

    /// <summary>
    /// When the contract was accepted, KSP's <c>Contract.DateAccepted</c>.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DateAccepted { get; set; }

    /// <summary>
    /// When an accepted contract must be completed by, KSP's
    /// <c>Contract.DateDeadline</c>. Passed through as KSP holds it, so a
    /// contract with no deadline carries <c>0</c> here rather than <c>null</c>.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DateDeadline { get; set; }

    /// <summary>
    /// When an offered contract is withdrawn if not accepted, KSP's
    /// <c>Contract.DateExpire</c>.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DateExpire { get; set; }

    /// <summary>
    /// The contract's top-level objectives, in KSP's order. Nested
    /// sub-parameters are not listed. Always present, empty when the contract
    /// has none.
    /// </summary>
    public List<CareerContractParameter> Parameters { get; set; } = new();
}

/// <summary>One parameter (objective) of a <see
/// cref="CareerContract"/>.</summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerContractParameter
{
    /// <summary>The objective's display title, KSP's ContractParameter.Title.</summary>
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
    /// <see cref="KspParameterState"/>. Branch on this rather than on the
    /// spelling of <see cref="State"/>: matching a label means an unrecognised
    /// spelling reads as outstanding, and a contract-parameter alarm set on
    /// "Complete" never fires.
    ///
    /// <para><c>null</c> when the capture carried no state, which is a third
    /// value and must not be read as either complete or incomplete.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public KspParameterState? StateOrdinal { get; set; }

    /// <summary>
    /// Lower bound of the altitude band this objective requires, from the
    /// stock <c>ReachAltitudeEnvelope</c> it is or contains (a part test
    /// nests its envelope under itself). <c>null</c> when it carries none.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? MinAltitude { get; set; }

    /// <summary>
    /// Upper bound of that same band, <c>null</c> exactly when
    /// <see cref="MinAltitude"/> is.
    /// </summary>
    [SitrepUnit(Units.Metres)]
    public double? MaxAltitude { get; set; }
}

/// <summary>
/// Strategies sub-group of <see cref="CareerStatus"/>. Both lists are always
/// present (empty, never null).
/// </summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerStrategies
{
    /// <summary>
    /// The strategies currently active, in the same entry shape as
    /// <see cref="All"/>. Not filtered against the Administration Building's
    /// cap, so a save that carries more active strategies than its building
    /// allows shows all of them.
    /// </summary>
    public List<CareerStrategy> Active { get; set; } = new();

    /// <summary>
    /// Every strategy the save knows about, active or not.
    /// </summary>
    public List<CareerStrategy> All { get; set; } = new();

    /// <summary>
    /// How many strategies are active. Never null: it is the length of
    /// <see cref="Active"/> when the raw count is absent.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int ActiveCount { get; set; }

    /// <summary>
    /// Whether another mod replaces or alters KSP's own strategy activation:
    /// <c>true</c> when it does, <c>false</c> when the game's activation is its
    /// own, <c>null</c> when that could not be established.
    ///
    /// <para>With the Administration Building shut,
    /// <c>career.strategy.activate</c> commits a strategy only when this is
    /// <c>false</c>, and refuses otherwise: a mod that changes activation owns
    /// the procedure, and offers its own command for it. With the building open
    /// the game activates as it always does, whatever this says.</para>
    /// <internal>
    /// Read from Harmony's patch registry over Strategy.Activate and
    /// Strategy.CanBeActivated by StockActivationPatch, the same read the
    /// off-screen activation refuses on, so the roster and the command cannot
    /// disagree. A career mod that patches activation is what reads true.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? ActivationPatched { get; set; }
}

/// <summary>One strategy in <see cref="CareerStrategies.Active"/> / <see
/// cref="CareerStrategies.All"/>.</summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerStrategy
{
    /// <summary>
    /// The strategy's internal config name, KSP's <c>StrategyConfig.Name</c>
    /// (e.g. <c>"OutsourceRnDStrategy"</c>): stable across a save, and the id
    /// <see cref="ActivateStrategyArgs.StrategyId"/> takes.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>The strategy's display title, KSP's Strategy.Title.</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>The strategy's description text, KSP's Strategy.Description.</summary>
    [SitrepUnit(Units.Text)]
    public string? Description { get; set; }

    /// <summary>
    /// The name of the Administration department the strategy belongs to,
    /// KSP's Strategy.DepartmentName.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Department { get; set; }

    /// <summary>Whether the strategy is active, KSP's Strategy.IsActive.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IsActive { get; set; }

    /// <summary>
    /// The strategy's commitment level, KSP's Strategy.Factor: the position of
    /// its commitment slider as a 0..1 fraction.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? Factor { get; set; }

    /// <summary>
    /// When the strategy was activated, KSP's Strategy.DateActivated.
    /// Meaningful only while <see cref="IsActive"/> is <c>true</c>.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DateActivated { get; set; }

    /// <summary>
    /// The reputation the career needs before the strategy can be activated,
    /// KSP's Strategy.RequiredReputation.
    /// </summary>
    [SitrepUnit(Units.Reputation)]
    public double? RequiredReputation { get; set; }

    /// <summary>
    /// The funds charged on activation, KSP's Strategy.InitialCostFunds.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? InitialCostFunds { get; set; }

    /// <summary>
    /// The science charged on activation, KSP's Strategy.InitialCostScience.
    /// </summary>
    [SitrepUnit(Units.Science)]
    public double? InitialCostScience { get; set; }

    /// <summary>
    /// The reputation charged on activation,
    /// KSP's Strategy.InitialCostReputation.
    /// </summary>
    [SitrepUnit(Units.Reputation)]
    public double? InitialCostReputation { get; set; }

    /// <summary>
    /// Whether the strategy offers a commitment slider, so that
    /// <see cref="Factor"/> can be chosen, KSP's Strategy.HasFactorSlider.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? HasFactorSlider { get; set; }

    /// <summary>
    /// The 0..1 position the game starts the commitment slider at,
    /// KSP's Strategy.FactorSliderDefault.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? FactorSliderDefault { get; set; }

    /// <summary>
    /// How many discrete positions the commitment slider has,
    /// KSP's Strategy.FactorSliderSteps.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? FactorSliderSteps { get; set; }

    /// <summary>
    /// Whether KSP would allow this strategy to be committed to right now.
    /// <c>null</c> means the question could not be put at all, which is NOT a
    /// refusal: <see cref="ActivateBlockedReason"/> then says why no check could
    /// run rather than naming a rule the strategy broke.
    /// <internal>
    /// Written from Gonogo.KSP.StrategyEligibility.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? CanActivate { get; set; }

    /// <summary>
    /// KSP's own wording for the rule that refused, or an installed career mod's
    /// wording for a rule of its own, or an account of why the question could not
    /// be put when <see cref="CanActivate"/> is <c>null</c>.
    /// Empty when activation is allowed.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? ActivateBlockedReason { get; set; }

    /// <summary>
    /// Which route produced <see cref="CanActivate"/>: <c>"screened"</c> when
    /// KSP's own check ran, <c>"derived"</c> when the same rules were checked
    /// one at a time because the Administration Building was shut, or when the
    /// strategy is already active, and <c>"none"</c> when there is no verdict to
    /// carry.
    ///
    /// <para><c>"derived"</c> always accompanies a refusal and never a yes. The
    /// game stops at its first refusal, so a rule that refuses off-screen would
    /// have refused on it; but one rule counts the career's running strategies
    /// on that screen and cannot be checked anywhere else, and permission needs
    /// every rule to pass. A strategy no rule refused therefore arrives with no
    /// verdict and <c>"none"</c> rather than as allowed.</para>
    ///
    /// <para>Never enable an activation control from a <c>"derived"</c> verdict:
    /// it can only refuse. Whether a strategy without a verdict may be committed
    /// is decided by <c>career.strategy.activate</c> itself, which runs every
    /// check again at the moment it executes and refuses in the game's words or
    /// as unreadable rather than guessing.</para>
    /// <internal>
    /// StrategyActivationRule walks checks 2-9 of Strategies.Strategy.
    /// CanBeActivated. The commit ceiling comes from GameVariables, which is
    /// where Administration.Start reads it from itself and which is virtual so a
    /// retiering mod's override is inherited. Check 1 is deliberately not
    /// reproduced: activeStrategyCount is a scroll-view item counter a career
    /// mod can overwrite, so substituting a roster count would enforce stock's rule on a
    /// career that has replaced it. The write side applies check 1 off the
    /// roster only after confirming nothing has patched stock's activation,
    /// which is the one case where the roster count and the screen's counter
    /// agree.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? ActivateVerdictSource { get; set; }

    /// <summary>
    /// Whether KSP would allow this strategy to be ended right now,
    /// KSP's Strategy.CanBeDeactivated. <c>false</c> with a reason beginning
    /// <c>"eligibility check failed: "</c> when the check itself threw.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? CanDeactivate { get; set; }

    /// <summary>
    /// KSP's own wording for why the strategy cannot be ended, or the failed
    /// check described in <see cref="CanDeactivate"/>. Empty or <c>null</c> when
    /// deactivation is allowed.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? DeactivateBlockedReason { get; set; }

    /// <summary>
    /// KSP's text describing what the strategy does while active,
    /// Strategy.Effect.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Effect { get; set; }
}

/// <summary>
/// Tech sub-group of <see cref="CareerStatus"/>. Both lists are always present
/// (empty, never null).
/// </summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerTech
{
    /// <summary>
    /// How many distinct tech nodes are unlocked. Never null: it is the length
    /// of <see cref="UnlockedIds"/> when the raw count is absent.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int UnlockedCount { get; set; }

    /// <summary>
    /// The ids of the unlocked tech nodes, in no particular order. Derived from
    /// the loaded parts (each part's <c>TechRequired</c> whose tech is
    /// available), so a node that unlocks no part never appears here even when
    /// it is researched; <see cref="CareerTechNode.Unlocked"/> is the per-node
    /// reading.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string> UnlockedIds { get; set; } = new();

    /// <summary>
    /// Every node of the tech tree the save is playing, including a tree a mod
    /// has replaced. Empty when the tree is not loaded yet.
    /// </summary>
    public List<CareerTechNode> Nodes { get; set; } = new();
}

/// <summary>One node in <see cref="CareerTech.Nodes"/>.</summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerTechNode
{
    /// <summary>The node's tech id, KSP's <c>techID</c> (e.g. <c>"basicRocketry"</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>
    /// The node's display title, from
    /// <c>ResearchAndDevelopment.GetTechnologyTitle</c>.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>
    /// The node's flavour line, as the tech tree itself writes it ("How hard
    /// can Rocket Science be anyway?").
    ///
    /// <para>It comes from the tree's own config rather than from
    /// <c>RDTech</c>, whose <c>description</c> field only exists while the
    /// R&amp;D Building scene is open. A tech tree a mod has replaced is
    /// read the same way, so this is the node's description in whatever tree
    /// the save is playing.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Description { get; set; }

    /// <summary>
    /// The science it costs to research the node, from the tree's config.
    /// </summary>
    [SitrepUnit(Units.Science)]
    public double? ScienceCost { get; set; }

    /// <summary>
    /// Whether the node is researched in this save
    /// (<c>ResearchAndDevelopment.GetTechnologyState</c> is <c>Available</c>).
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Unlocked { get; set; }

    /// <summary>
    /// The tech ids of the node's prerequisites, from the tree's parent edges.
    /// Empty for a root node. Whether a locked node is researchable is left to
    /// the client, from these edges and each parent's
    /// <see cref="Unlocked"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string> Parents { get; set; } = new();
}
