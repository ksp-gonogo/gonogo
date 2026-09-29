using System;
using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The root refusals: the closed set every client can switch on. Each says
/// what kind of refusal it was, and so whether waiting, changing the craft, or
/// doing something in the game is what makes a retry worthwhile.
///
/// <para>A producer that can say more names a refinement of one of these (see
/// <see cref="RefusalCode.Refine"/>); the root still travels, so nothing a client
/// does with a root depends on knowing the refinement.</para>
/// </summary>
public static class CommandErrorCode
{
    /// <summary>There is no active vessel to act on.</summary>
    public static readonly RefusalCode NoVessel = RefusalCode.DeclareRoot("noVessel", "there is no vessel to act on");

    /// <summary>The requested mode or state is not available, and the game gave no more specific reason.</summary>
    public static readonly RefusalCode ModeUnavailable = RefusalCode.DeclareRoot("modeUnavailable", "the game would not say why");

    /// <summary>An argument was out of its valid range.</summary>
    public static readonly RefusalCode Range = RefusalCode.DeclareRoot("range", "an argument was outside its valid range");

    /// <summary>The referenced entity (a node id, a vessel or body target, a craft name) did not resolve.</summary>
    public static readonly RefusalCode NotFound = RefusalCode.DeclareRoot("notFound", "nothing here answers to that");

    /// <summary>
    /// The maneuver plan is owned by a planner other than stock's
    /// <c>patchedConicSolver</c>, so a node written there would never be used.
    ///
    /// <para>Refused rather than attempted: an n-body planner clears stock's node
    /// list every frame and writes its own guidance node into it, so a written
    /// node would show on the board and do nothing. The owning planner is on the
    /// wire as <c>VesselManeuver.Planner</c>.</para>
    /// </summary>
    public static readonly RefusalCode PlanNotOwned = RefusalCode.DeclareRoot("planNotOwned", "another planner owns the flight plan");

    /// <summary>
    /// A capacity is full: the Astronaut Complex holds its cap of active crew,
    /// a facility holds its cap of anything else countable.
    ///
    /// <para>A retry succeeds only once something changes, such as freeing a
    /// slot.</para>
    ///
    /// <para><see cref="Sitrep.Contract.CommandResult.Breach"/> carries the
    /// numbers, so a client can say "16 of 16".</para>
    /// </summary>
    public static readonly RefusalCode LimitReached = RefusalCode.DeclareRoot("limitReached", "a limit has been reached");

    /// <summary>
    /// Already at the top of an upgradeable scale, so there is nothing above
    /// this to move to. The Launch Pad at tier 3 of 3.
    ///
    /// <para>Not <see cref="LimitReached"/>: a cap that is full can be freed; a
    /// maximum tier cannot be exceeded by any action at all.</para>
    /// </summary>
    public static readonly RefusalCode AlreadyAtMaximum = RefusalCode.DeclareRoot("alreadyAtMaximum", "it is already at its maximum");

    /// <summary>
    /// The command costs more than the funds on hand.
    ///
    /// <para><see cref="Sitrep.Contract.CommandResult.Breach"/> carries the cost as
    /// <c>Actual</c> against the balance as <c>Limit</c>, so the client can say
    /// how short and in the operator's own currency rendering.</para>
    /// </summary>
    public static readonly RefusalCode InsufficientFunds = RefusalCode.DeclareRoot("insufficientFunds", "there are not enough funds");

    /// <summary>
    /// The command costs more science than is banked. Separate from
    /// <see cref="InsufficientFunds"/>, as the game keeps science and funds
    /// separate currencies.
    ///
    /// <para>Authority: <c>CurrencyModifierQuery.RunQuery(reason, ...).CanAfford(Currency.Science)</c>,
    /// which is what <c>RDTech.ResearchTech</c> checks, modifiers included.
    /// <internal>Not <c>ResearchAndDevelopment.CanAfford</c>, which skips the
    /// modifier chain and so disagrees with what the game acts on.</internal></para>
    /// </summary>
    public static readonly RefusalCode InsufficientScience = RefusalCode.DeclareRoot("insufficientScience", "there is not enough science");

    /// <summary>
    /// The save is not a career save, so this command's whole subsystem does not
    /// exist here.
    ///
    /// <para>Authority: <c>HighLogic.CurrentGame.Mode</c>, and in practice the
    /// null <c>Instance</c> of the <c>ScenarioModule</c> that would have
    /// served it (<c>Funding</c>, <c>ContractSystem</c>, <c>StrategySystem</c>,
    /// <c>ResearchAndDevelopment</c>, <c>ScenarioUpgradeableFacilities</c>).</para>
    ///
    /// <para>A permanent property of the save, not a state that may change, so a
    /// client can hide the control rather than show it refused.</para>
    /// </summary>
    public static readonly RefusalCode CareerModeRequired = RefusalCode.DeclareRoot("careerModeRequired", "this save is not a career game");

    /// <summary>
    /// The game is in a scene this command cannot run from.
    ///
    /// <para>Authority: <c>HighLogic.LoadedScene</c> (<c>GameScenes</c>).
    /// <see cref="Sitrep.Contract.CommandResult.Detail"/> names the scene when the producer had
    /// one.</para>
    /// </summary>
    public static readonly RefusalCode WrongScene = RefusalCode.DeclareRoot("wrongScene", "the game is not in a scene that allows it");

    /// <summary>
    /// The entity is not in a state this transition applies to: an already-active
    /// strategy asked to activate, an already-researched node asked to unlock, a
    /// contract asked to accept when it is not offered, an assigned kerbal asked
    /// to be sacked, a spent experiment asked to deploy.
    ///
    /// <para>Authority: the entity's own state enum. <c>Strategies.Strategy.IsActive</c>,
    /// <c>RDTech.State</c>, <c>Contract.State</c>,
    /// <c>ProtoCrewMember.RosterStatus</c>,
    /// <c>ModuleScienceExperiment.Deployed</c>/<c>Inoperable</c>. Every one of
    /// those is <c>[Description]</c>-tagged or otherwise nameable, so
    /// <see cref="Sitrep.Contract.CommandResult.Detail"/> can carry the state in the game's own
    /// words.</para>
    /// </summary>
    public static readonly RefusalCode WrongState = RefusalCode.DeclareRoot("wrongState", "it is not in a state that allows it");

    /// <summary>
    /// Right command, wrong moment: the flight is not in a state that permits it
    /// yet, and will be later.
    ///
    /// <para>Authority: <c>FlightGlobals.ClearToSave()</c>, which returns one of
    /// five refusals (in atmosphere, under acceleration, moving over the
    /// surface, about to crash, on a ladder), plus
    /// <c>FlightDriver.CanRevertToPostInit</c>/<c>CanRevertToPrelaunch</c> and
    /// the <c>GameParameters</c> flags for leaving to the space center and to
    /// the tracking station. The game's reason is on
    /// <see cref="Sitrep.Contract.CommandResult.Detail"/>.</para>
    ///
    /// <para>Also returned by the SCET alarm command for a vantage it cannot check because no
    /// command centre is known to the simulation yet: the main menu, and the
    /// ticks before the first capture. A vantage that is known and inactive is
    /// <see cref="Range"/> instead, because that one does not resolve by
    /// waiting.</para>
    ///
    /// <para>Distinct from <see cref="WrongState"/>, which is about the entity
    /// and does not resolve by waiting.
    /// <internal>
    /// <c>ClearToSaveStatus</c> declares seven members, but <c>ClearToSave</c>
    /// itself produces only five: nothing in <c>Assembly-CSharp</c> assigns
    /// <c>NOT_WHILE_THROTTLED_UP</c>, and <c>ORBIT_EVENT_IMMINENT</c> comes only
    /// from <c>TimeWarp.getMaxOnRailsRateIdx</c>, a different authority.
    /// </internal></para>
    /// </summary>
    public static readonly RefusalCode NotClearToProceed = RefusalCode.DeclareRoot("notClearToProceed", "the flight is not clear for it yet");

    /// <summary>
    /// The part or vessel does not have the capability this command needs: a
    /// rotor asked for a target angle, an unmotorised servo asked to drive, a
    /// part with no such action, an action present but inert, an autopilot mode
    /// this craft cannot hold.
    ///
    /// <para>Authority: the part's own module list and fields
    /// (<c>ModuleRoboticServoRotor</c>/<c>Hinge</c>/<c>Piston</c>,
    /// <c>servoIsMotorized</c>, <c>BaseEvent.active</c>,
    /// <c>BaseEvent.EventIsDisabledByVariant</c>) and
    /// <c>VesselAutopilot.CanSetMode</c>.</para>
    ///
    /// <para>Nothing an operator waits for. The craft would have to be different
    /// for this to work, which is why it is not <see cref="NotClearToProceed"/>
    /// and not <see cref="WrongState"/>.</para>
    /// </summary>
    public static readonly RefusalCode CapabilityMismatch = RefusalCode.DeclareRoot("capabilityMismatch", "this craft cannot do it");

    /// <summary>
    /// There is no usable link for what this command needs to send.
    ///
    /// <para>Authority: <c>ScienceUtil.GetBestTransmitter(Vessel)</c> and
    /// <c>IScienceDataTransmitter.CanTransmit()</c>: the vessel has no antenna
    /// that can carry the payload. This is not the comms-loss refusal that stops
    /// a command before it reaches the vessel.</para>
    /// </summary>
    public static readonly RefusalCode NoConnection = RefusalCode.DeclareRoot("noConnection", "there is no usable link");

    /// <summary>
    /// The capability exists in the game but this save has not unlocked it: fuel
    /// transfer, custom action groups, flight planning, EVA, the maneuver tool.
    ///
    /// <para>Authority: <c>GameVariables.UnlockedFuelTransfer</c>,
    /// <c>UnlockedActionGroupsStock</c>/<c>Custom</c>,
    /// <c>UnlockedFlightPlanning</c>, <c>UnlockedEVA</c>/<c>Flags</c>/<c>Clamber</c>,
    /// <c>ManeuverToolAvailable</c>, each read at the owning facility's
    /// normalised level.</para>
    ///
    /// <para>Distinct from <see cref="LimitReached"/>, which is a number against
    /// a number. This is a switch that is off, and the fix is an upgrade rather
    /// than freeing a slot.</para>
    /// </summary>
    public static readonly RefusalCode NotUnlocked = RefusalCode.DeclareRoot("notUnlocked", "it has not been unlocked yet");

    /// <summary>
    /// Another vessel is on the launch site.
    ///
    /// <para>Authority: <c>PreFlightTests.LaunchSiteClear</c>, whose
    /// <c>GetWarningTitle()</c>/<c>GetWarningDescription()</c> are the game's own
    /// words for it and ride on <see cref="Sitrep.Contract.CommandResult.Detail"/>.</para>
    /// </summary>
    public static readonly RefusalCode SiteOccupied = RefusalCode.DeclareRoot("siteOccupied", "another vessel is on the launch site");

    /// <summary>
    /// The facility this command needs is destroyed or damaged.
    ///
    /// <para>Authority: <c>PreFlightTests.FacilityOperational</c>, over
    /// <c>PSystemSetup.Instance.GetSpaceCenterFacility(name).GetFacilityDamage()</c>.</para>
    /// </summary>
    public static readonly RefusalCode FacilityDamaged = RefusalCode.DeclareRoot("facilityDamaged", "the building is out of action");

    /// <summary>
    /// The vehicle is not a launchable article yet: an install's build and
    /// logistics model has work outstanding on it. Nothing is over a limit and
    /// nothing is broken, the thing simply has not been made ready.
    ///
    /// <para>Authority: whichever Uplink contributed the readiness requirement
    /// that refused (see <see cref="IUplinkHost.AddCommandRequirement"/>), never
    /// a stock KSP read: stock has no build step, so this code never arrives on
    /// a stock install. Under a build model it may be a vehicle that was never
    /// integrated, one still integrating, one finished but not rolled out, or one
    /// rolled out to a pad still being reconditioned.
    /// <see cref="Sitrep.Contract.CommandResult.Detail"/> says which.</para>
    ///
    /// <para>Not <see cref="LimitReached"/>, the launch refusal for a craft too
    /// heavy or too large for the site, fixed by changing the craft or upgrading
    /// the pad. This one is fixed by doing the outstanding work.</para>
    ///
    /// <para>Not <see cref="NotFound"/> either, which <c>ksp.launch</c> returns
    /// when no craft file has the name. A craft that exists on disk and has
    /// never been built is a different situation from one that does not
    /// exist.</para>
    /// </summary>
    public static readonly RefusalCode NotReady = RefusalCode.DeclareRoot("notReady", "the vehicle is not ready to fly yet");

    /// <summary>
    /// The command consumes a countable ITEM and there are not enough of them
    /// aboard: an EVA repair kit for a repair, on a provider that charges one.
    ///
    /// <para>Authority: the provider's own charge, the same one it states on
    /// <see cref="ReliabilityPartEntry.RepairCost"/>, so the cost shown and the
    /// cost taken agree. The item is the provider's to name: this code says only
    /// that there were too few, never which item.</para>
    ///
    /// <para>Separate from <see cref="InsufficientFunds"/> and
    /// <see cref="InsufficientScience"/>: a physical item cannot be bought.</para>
    ///
    /// <para>Not <see cref="LimitReached"/>, which is a capacity that is full.
    /// This is a store that is empty.</para>
    /// </summary>
    public static readonly RefusalCode InsufficientResource = RefusalCode.DeclareRoot("insufficientResource", "there are not enough of what it uses aboard");

    /// <summary>
    /// The provider was asked and could not read the state it needed. Nothing
    /// about the craft, the save or the moment was established, so the one fact
    /// this refusal carries is that the question went unresolved.
    ///
    /// <para>Not <see cref="CapabilityMismatch"/>, which is an established fact
    /// about the craft (a genuine omni antenna asked to aim). Not
    /// <see cref="NotFound"/>, which says the craft carries nothing this command
    /// could act on. Not <see cref="NotClearToProceed"/>, which resolves by
    /// waiting; this does not, and a retry is a second attempt at the same
    /// question.</para>
    ///
    /// <para><see cref="Sitrep.Contract.CommandResult.Detail"/> names what could not be read
    /// when the producer had a name for it, and never says what the result would
    /// have been. Nothing was learned about the vehicle, so offering the command
    /// again is the only sound next move.
    /// <internal>
    /// In practice a reflection read whose member does not resolve on the loaded
    /// assembly, or resolves and throws: the fail-soft posture every Uplink
    /// takes towards a third-party mod it cannot compile against.
    /// </internal></para>
    /// </summary>
    public static readonly RefusalCode Unreadable = RefusalCode.DeclareRoot("unreadable", "the game would not answer");

    /// <summary>
    /// The command acts at a PLACE, and the command centre it was sent from has
    /// no authority there: a launch from a pad in another planet's system.
    ///
    /// <para>Authority, never delay. The command itself is still instant; what
    /// this refuses is the sender, not the moment, so no amount of waiting makes
    /// it succeed. Sending from a centre in the place's own system does.</para>
    ///
    /// <para><see cref="Sitrep.Contract.CommandResult.Detail"/> names the centre and the place,
    /// and the system each is in, so an operator learns which seat to move to
    /// rather than seeing a control that simply does nothing.</para>
    ///
    /// <para>Distinct from <see cref="NoConnection"/>, which is a link that
    /// cannot carry the command. A centre may be perfectly linked to the place
    /// and still have no authority over it.</para>
    /// </summary>
    public static readonly RefusalCode OutOfReach = RefusalCode.DeclareRoot("outOfReach", "this command centre has no authority over that place");

    // Built on first use rather than in the static initialiser: a core
    // refinement's holder reads these roots from its own initialiser, so an
    // eager index could run while that holder's fields are still null.
    private static Dictionary<string, RefusalCode>? _byId;

    /// <summary>Every root, in declaration order.</summary>
    public static IReadOnlyList<RefusalCode> Roots => ErrorCodeCatalog.Of(typeof(CommandErrorCode));

    /// <summary>Every refinement core itself declares, in declaration order.</summary>
    public static IReadOnlyList<RefusalCode> CoreRefinements => ErrorCodeCatalog.Of(typeof(RepairRefusal));

    /// <summary>The core-declared code (a root or a core refinement) with this id, or null.</summary>
    public static RefusalCode? Find(string id) =>
        id != null && (_byId ??= IndexById()).TryGetValue(id, out var code) ? code : null;

    private static Dictionary<string, RefusalCode> IndexById()
    {
        var byId = new Dictionary<string, RefusalCode>(StringComparer.Ordinal);
        foreach (var code in Roots) byId[code.Id] = code;
        foreach (var code in CoreRefinements) byId[code.Id] = code;
        return byId;
    }
}

/// <summary>
/// What every command returns. A refused command has <see cref="Success"/>
/// false and a typed <see cref="ErrorCode"/> saying why, so a client never
/// matches on message text.
///
/// <para>This is the result of a command that returns no value. A command that
/// does returns <see cref="CommandResult{T}"/>, which adds a
/// <c>Payload</c>.</para>
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
// AutoExportMethods=false: the static Ok/Fail factories are C#-side ergonomics,
// not wire shape: without this rtcli emits them as bogus interface members.
[TsInterface(AutoExportMethods = false)]
#endif
public class CommandResult
{
    /// <summary>Whether the command ran. False means the game refused it.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Success { get; set; } = true;

    /// <summary>
    /// Why it was refused, null on success. On the wire this is the ROOT's id,
    /// so every client can classify it; a refinement's own id travels beside it
    /// as <see cref="Reason"/>.
    /// </summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "CommandErrorCode", ForceNullable = true)]
#endif
    [SitrepUnit(Units.Enumeration)]
    [SitrepOmittedWhenNull]
    public RefusalCode? ErrorCode { get; set; }

    /// <summary>
    /// The refinement's id, when the refusal is more specific than its root:
    /// <c>example.notManaging</c> under <c>careerModeRequired</c>. Absent when the
    /// refusal is a root. An id this client does not know is still a refusal
    /// of kind <see cref="ErrorCode"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    [SitrepOmittedWhenNull]
    public string? Reason => ErrorCode is { IsRoot: false } ? ErrorCode.Id : null;

    /// <summary>
    /// The numbers behind the refusal, when the refusal has any: the cap and the
    /// count, the tier and the top tier, the price and the balance. Null on
    /// success and on every refusal that is not a comparison.
    ///
    /// <para><see cref="ErrorCode"/> picks the sentence and this fills in its
    /// numbers, as in "16 of 16 active crew".</para>
    ///
    /// <para>The same <see cref="LimitBreach"/> shape a declared gate carries on
    /// <see cref="GateVerdict.Breach"/>, so a refusal reads the same whether it
    /// came from a gate or from the command's own handler. Omitted from the wire
    /// when null.</para>
    /// </summary>
    [SitrepOmittedWhenNull]
    public LimitBreach? Breach { get; set; }

    /// <summary>
    /// The refusal in the GAME's own words, when the game had any: the member of
    /// <c>ClearToSaveStatus</c> it came back with,
    /// <c>Strategies.Strategy.CanBeActivated(out string reason)</c>'s reason,
    /// <c>GameVariables.GetEVALockedReason</c>'s sentence, a
    /// <c>PreFlightTests.IPreFlightTest</c>'s <c>GetWarningTitle()</c>, a
    /// <c>[Description]</c>-tagged state member's name. Empty when the refusal
    /// had nothing to quote: omitted from the wire, never an empty string.
    ///
    /// <para>The text is the game's own, so it is in the game's language.</para>
    ///
    /// <para>Prose for a human, never parsed: <see cref="ErrorCode"/> is the
    /// machine-readable half. The same split, and the same field name, as
    /// <see cref="GateVerdict.Detail"/>.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    [SitrepOmittedWhenNull]
    public string? Detail { get; set; }

    /// <summary>A command that ran.</summary>
    public static CommandResult Ok() => new CommandResult { Success = true };

    /// <summary>A refusal with nothing more to say than its code.</summary>
    public static CommandResult Fail(RefusalCode errorCode) =>
        new CommandResult { Success = false, ErrorCode = errorCode };

    /// <summary>A refusal that quotes the game. A null, empty or whitespace <paramref name="detail"/> leaves <see cref="Detail"/> null. See <see cref="Detail"/>.</summary>
    public static CommandResult Fail(RefusalCode errorCode, string? detail) =>
        new CommandResult
        {
            Success = false,
            ErrorCode = errorCode,
            // Whitespace is not a sentence: an empty Detail on the wire would render as a refusal that quoted nothing.
            Detail = string.IsNullOrWhiteSpace(detail) ? null : detail,
        };

    /// <summary>A refusal that carries its comparison. See <see cref="Breach"/>.</summary>
    public static CommandResult Fail(RefusalCode errorCode, LimitBreach breach) =>
        new CommandResult { Success = false, ErrorCode = errorCode, Breach = breach };
}

/// <summary>
/// A <see cref="CommandResult"/> that also returns a value in <c>payload</c>:
/// <c>vessel.control.stage</c> returns the new current stage index, and
/// <c>vessel.maneuver.add</c> returns the created node's id. <c>payload</c> is
/// absent when <see cref="CommandResult.Success"/> is false.
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
// AutoExportMethods=false: the static Ok/Fail factories are C#-side ergonomics,
// not wire shape: without this rtcli emits them as bogus interface members.
[TsInterface(AutoExportMethods = false)]
#endif
public class CommandResult<T> : CommandResult
{
    /// <summary>The value the command returns; absent on a refusal.</summary>
    public T? Payload { get; set; }

    /// <summary>A command that ran and returned <paramref name="payload"/>.</summary>
    public static CommandResult<T> Ok(T payload) =>
        new CommandResult<T> { Success = true, Payload = payload };

    /// <summary>A refusal with nothing more to say than its code.</summary>
    public static new CommandResult<T> Fail(RefusalCode errorCode) =>
        new CommandResult<T> { Success = false, ErrorCode = errorCode };

    /// <summary>A refusal that quotes the game. A null, empty or whitespace <paramref name="detail"/> leaves <see cref="CommandResult.Detail"/> null.</summary>
    public static new CommandResult<T> Fail(RefusalCode errorCode, string? detail) =>
        new CommandResult<T>
        {
            Success = false,
            ErrorCode = errorCode,
            Detail = string.IsNullOrWhiteSpace(detail) ? null : detail,
        };

    /// <summary>A refusal that carries its comparison. See <see cref="CommandResult.Breach"/>.</summary>
    public static new CommandResult<T> Fail(RefusalCode errorCode, LimitBreach breach) =>
        new CommandResult<T> { Success = false, ErrorCode = errorCode, Breach = breach };
}
