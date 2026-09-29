#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// <c>career.strategy.activate</c>'s args: the strategy's stable id plus the
/// slider fraction to activate it at. <see cref="StrategyId"/> is
/// <c>StrategyConfig.Name</c> (e.g. <c>"OutsourceRnDStrategy"</c>): the same
/// id <c>career.status</c> publishes for each strategy as
/// <c>strategies[].id</c>, so a client activates using the id it read.
/// <see cref="Factor"/> is the 0 to 1 slider fraction the strategy is committed
/// at (its up-front funds, science and reputation cost scales with it); a
/// strategy with no factor slider ignores it and activates at its fixed
/// factor.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("career.strategy.activate")]
public class ActivateStrategyArgs
{
    /// <summary>The strategy to activate: its <c>StrategyConfig.Name</c>, as <c>career.status</c>'s <c>strategies[].id</c> carries it.</summary>
    [SitrepUnit(Units.Id)]
    public string StrategyId { get; set; } = "";

    /// <summary>0 to 1 slider fraction; ignored by strategies without a factor
    /// slider.</summary>
    [SitrepUnit(Units.Ratio)]
    public double Factor { get; set; }
}

/// <summary><c>career.strategy.deactivate</c>'s args: the strategy's stable
/// <c>StrategyConfig.Name</c> id (see <see
/// cref="ActivateStrategyArgs.StrategyId"/>).</summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("career.strategy.deactivate")]
public class DeactivateStrategyArgs
{
    /// <summary>The active strategy to deactivate: its <c>StrategyConfig.Name</c>, as <c>career.status</c>'s <c>strategies[].id</c> carries it.</summary>
    [SitrepUnit(Units.Id)]
    public string StrategyId { get; set; } = "";
}

/// <summary>
/// <c>career.tech.unlock</c>'s args: the tech node's <c>techID</c>, the same id
/// <c>career.status</c> publishes for each tech node as
/// <c>tech.nodes[].id</c>. Unlocking deducts the node's science cost.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("career.tech.unlock")]
public class UnlockTechArgs
{
    /// <summary>The tech node to unlock: its KSP <c>techID</c> (e.g. <c>"basicRocketry"</c>), as <c>career.status</c>'s <c>tech.nodes[].id</c> carries it.</summary>
    [SitrepUnit(Units.Id)]
    public string TechId { get; set; } = "";
}

/// <summary> Args shared by
/// <c>career.contract.accept</c>/<c>decline</c>/<c>cancel</c>: the contract's
/// stable <c>ContractID</c> as a string, the same id <c>career.status</c>
/// publishes for each contract as <c>contracts[].id</c>. Which of the
/// three verbs is valid depends on the contract's current state (accept/decline
/// require an offered contract, cancel an active one); an out-of-state request
/// comes back <see cref="CommandErrorCode.ModeUnavailable"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("career.contract.accept")]
[SitrepCommand("career.contract.decline")]
[SitrepCommand("career.contract.cancel")]
public class ContractActionArgs
{
    /// <summary>The contract to act on: its KSP <c>ContractID</c> as a string, as <c>career.status</c>'s <c>contracts[].id</c> carries it.</summary>
    [SitrepUnit(Units.Id)]
    public string ContractId { get; set; } = "";
}

/// <summary>
/// <c>career.facility.upgrade</c>'s args: the facility's
/// <c>SpaceCenterFacility</c> enum name (e.g. <c>"VehicleAssemblyBuilding"</c>,
/// <c>"LaunchPad"</c>), the same key <see cref="CareerFacilities"/>'s
/// <c>facilities</c> map uses on the <c>career.facilities</c> channel (the
/// buildings are not on <c>career.status</c>). Upgrading raises the facility
/// one tier and deducts its upgrade cost from funds.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("career.facility.upgrade")]
public class UpgradeFacilityArgs
{
    /// <summary>The facility to upgrade: its <c>SpaceCenterFacility</c> enum name, as a key of <c>career.facilities</c>' <c>facilities</c> map.</summary>
    [SitrepUnit(Units.Id)]
    public string FacilityId { get; set; } = "";
}

/// <summary> <c>career.crew.hire</c>'s args: the applicant's
/// <c>ProtoCrewMember.name</c>, the same id <c>spaceCenter.astronautComplex</c>
/// publishes for each applicant as <c>applicants[].name</c>, so a client hires
/// the applicant it read. Hiring debits the current recruit cost from funds
/// and moves the applicant into the crew roster. An applicant that has left
/// the pool since it was read (someone else hired them, or KSP refreshed the
/// pool) fails with <see cref="CommandErrorCode.NotFound"/>; an unaffordable
/// hire with <see cref="CommandErrorCode.Range"/>; a full roster
/// (Astronaut Complex cap) or a non-career save <see
/// cref="CommandErrorCode.ModeUnavailable"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("career.crew.hire")]
public class HireApplicantArgs
{
    /// <summary>The applicant to hire: their name, as <c>spaceCenter.astronautComplex</c>'s <c>applicants[].name</c> carries it.</summary>
    [SitrepUnit(Units.Id)]
    public string ApplicantName { get; set; } = "";
}

/// <summary> <c>career.crew.fire</c>'s args: a hired kerbal's
/// <c>ProtoCrewMember.name</c>, the same id <c>spaceCenter.crewRoster</c>
/// publishes for each roster entry. Firing (<c>KerbalRoster.SackAvailable</c>)
/// costs nothing and returns the kerbal to the applicant pool, so it is
/// reversible: a re-hire brings them back with the same stats. Valid only on a
/// kerbal whose roster status is Available; a name not on the hired-crew
/// roster fails with <see cref="CommandErrorCode.NotFound"/>, and one that is
/// but is not Available (Assigned, Dead or Missing) with <see
/// cref="CommandErrorCode.ModeUnavailable"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("career.crew.fire")]
public class FireCrewArgs
{
    /// <summary>The kerbal to fire: their name, as a <c>spaceCenter.crewRoster</c> entry carries it.</summary>
    [SitrepUnit(Units.Id)]
    public string KerbalName { get; set; } = "";
}
