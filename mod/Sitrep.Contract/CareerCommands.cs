#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// <c>career.strategy.activate</c>'s args: the strategy's stable id plus the
/// slider fraction to activate it at. <see cref="StrategyId"/> is
/// <c>StrategyConfig.Name</c> (e.g. <c>"OutsourceRnDStrategy"</c>): the exact
/// same id the READ side emits for each strategy (<c>career.status</c>'s
/// <c>strategies[].id</c>), so a client activates using the id it already read.
/// <see cref="Factor"/> is the 0..1 slider fraction the strategy is committed
/// at (its up-front funds/science/reputation cost scales with it); it is
/// best-effort: a strategy with no factor slider ignores it and activates at
/// its fixed factor.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ActivateStrategyArgs
{
    [SitrepUnit(Units.Id)]
    public string StrategyId { get; set; } = "";

    /// <summary>0..1 slider fraction; ignored by strategies without a factor slider.</summary>
    [SitrepUnit(Units.Ratio)]
    public double Factor { get; set; }
}

/// <summary><c>career.strategy.deactivate</c>'s args: the strategy's stable <c>StrategyConfig.Name</c> id (see <see cref="ActivateStrategyArgs.StrategyId"/>).</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class DeactivateStrategyArgs
{
    [SitrepUnit(Units.Id)]
    public string StrategyId { get; set; } = "";
}

/// <summary>
/// <c>career.tech.unlock</c>'s args: the tech node's <c>techID</c> (the same id
/// the READ side emits for each tech node, <c>career.status</c>'s
/// <c>tech.nodes[].id</c>). Unlocking deducts the node's science cost.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class UnlockTechArgs
{
    [SitrepUnit(Units.Id)]
    public string TechId { get; set; } = "";
}

/// <summary>
/// Args shared by <c>career.contract.accept</c>/<c>decline</c>/<c>cancel</c>:
/// the contract's stable <c>ContractID</c> (stringified; the same id the READ
/// side emits for each contract, <c>career.status</c>'s <c>contracts[].id</c>).
/// Which of the three verbs is valid depends on the contract's current state
/// (accept/decline require an offered contract, cancel an active one); an
/// out-of-state request comes back <see cref="CommandErrorCode.ModeUnavailable"/>.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ContractActionArgs
{
    [SitrepUnit(Units.Id)]
    public string ContractId { get; set; } = "";
}

/// <summary>
/// <c>career.facility.upgrade</c>'s args: the facility's id as the READ side
/// keys it: the <c>SpaceCenterFacility</c> enum name (e.g.
/// <c>"VehicleAssemblyBuilding"</c>, <c>"LaunchPad"</c>), the same id
/// <c>career.status</c>'s <c>facilities</c> map uses. Upgrading raises the
/// facility one tier and deducts its upgrade cost from funds.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class UpgradeFacilityArgs
{
    [SitrepUnit(Units.Id)]
    public string FacilityId { get; set; } = "";
}

/// <summary>
/// <c>career.crew.hire</c>'s args: the applicant's <c>ProtoCrewMember.name</c>,
/// the same id the READ side emits for each applicant
/// (<c>spaceCenter.astronautComplex</c>'s <c>applicants[].name</c>), so a client
/// hires the applicant it read. Hiring debits the current recruit cost from
/// funds and moves the applicant into the crew roster. An applicant that has
/// left the pool since (a stale pool, someone else hired, KSP refreshed it)
/// comes back <see cref="CommandErrorCode.NotFound"/>; an unaffordable hire
/// <see cref="CommandErrorCode.Range"/>; a full roster (Astronaut Complex cap)
/// or a non-career save <see cref="CommandErrorCode.ModeUnavailable"/>.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class HireApplicantArgs
{
    [SitrepUnit(Units.Id)]
    public string ApplicantName { get; set; } = "";
}

/// <summary>
/// <c>career.crew.fire</c>'s args: a hired kerbal's <c>ProtoCrewMember.name</c>,
/// the same id the READ side emits for each roster row
/// (<c>spaceCenter.crewRoster</c>'s entries). Firing (<c>KerbalRoster.SackAvailable</c>)
/// costs nothing and simply returns the kerbal to the applicant pool, so it is
/// reversible (a re-hire brings them back with the same stats). Valid only on
/// a kerbal whose current roster standing is Available; a name that doesn't
/// resolve on the hired-crew roster comes back
/// <see cref="CommandErrorCode.NotFound"/>, one that resolves but isn't
/// Available (Assigned/Dead/Missing) comes back
/// <see cref="CommandErrorCode.ModeUnavailable"/>.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FireCrewArgs
{
    [SitrepUnit(Units.Id)]
    public string KerbalName { get; set; } = "";
}
