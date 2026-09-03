#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The typed, machine-readable failure code every command result carries,
/// R7 Fix 1's replacement for the bare <c>string</c> error codes
/// (<c>"E_RANGE"</c>/<c>"E_NOT_FOUND"</c>/<c>"E_MODE_UNAVAILABLE"</c>/
/// <c>"E_NO_VESSEL"</c>) the three hand-rolled result records used to return.
/// A string code forces the client to string-match a magic value that the
/// compiler can neither check nor enumerate. This enum
/// makes the failure surface a closed, typed set instead.
///
/// <para><see cref="None"/> is the success sentinel (paired with
/// <see cref="CommandResult.Success"/> = true); <see cref="Unknown"/> is the
/// forward-compatible fallback for any code a newer producer emits that an
/// older consumer doesn't recognise: the same <c>Unknown</c>-style
/// read-fallback convention every other enum in this contract uses.</para>
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum CommandErrorCode
{
    /// <summary>No error: the success sentinel, paired with <see cref="CommandResult.Success"/> = true.</summary>
    None = 0,

    /// <summary>Forward-compat fallback: a code a newer producer emitted that this consumer doesn't recognise.</summary>
    Unknown = 1,

    /// <summary>No active vessel to act on (was <c>"E_NO_VESSEL"</c>).</summary>
    NoVessel = 2,

    /// <summary>The requested mode/state isn't currently available (was <c>"E_MODE_UNAVAILABLE"</c>).</summary>
    ModeUnavailable = 3,

    /// <summary>An argument was out of its valid range (was <c>"E_RANGE"</c>).</summary>
    Range = 4,

    /// <summary>The referenced entity (node id, vessel/body target) didn't resolve (was <c>"E_NOT_FOUND"</c>).</summary>
    NotFound = 5,

    /// <summary>
    /// F2-fix backstop: the command was marshaled onto the host's main-thread
    /// pump but that pump did not drain it within the bounded wait (a
    /// scene-load / loading-screen stall). A synthetic failure returned by the
    /// host so the Courier thread can never park indefinitely, not emitted by
    /// any uplink handler. Additive (Major 2, Minor 0 -&gt; 1).
    /// </summary>
    Timeout = 6,

    /// <summary>
    /// The elected maneuver-plan provider is not the one that reads stock's
    /// <c>patchedConicSolver</c>, so a write there would never be seen.
    ///
    /// <para>Refused rather than attempted, because attempting it produces a
    /// GHOST NODE: we mutate stock's solver, the owning planner never reads it
    /// (an n-body backend clears that list every frame and writes its own
    /// guidance node into it), and the operator sees a maneuver node on the
    /// board that does precisely nothing. A silent wrong answer with a
    /// confident presentation.</para>
    ///
    /// <para>The code says WHY. It deliberately does not say WHO: this enum is
    /// typed precisely so a client never string-matches, and the owner is
    /// already on the wire as <c>VesselManeuver.Planner</c> for a readout to
    /// name. Additive (Major 5).</para>
    /// </summary>
    PlanNotOwned = 7,

    /// <summary>
    /// A capacity is full: the Astronaut Complex holds its cap of active crew,
    /// a facility holds its cap of anything else countable.
    ///
    /// <para>Split out of <see cref="ModeUnavailable"/>, which was carrying five
    /// unrelated causes at once (crew cap, facility maxed, no roster, no
    /// Funding, wrong scene) and so could not tell a permanent refusal from a
    /// transient one. This arm says the cap is reached and the world has to
    /// change before a retry means anything; freeing a slot is a thing an
    /// operator can actually do.</para>
    ///
    /// <para>The arm chooses the sentence, <see cref="CommandResult.Breach"/>
    /// supplies the numbers in it. Neither is worth sending without the other:
    /// a code with no payload cannot say "16 of 16".</para>
    /// </summary>
    LimitReached = 8,

    /// <summary>
    /// Already at the top of an upgradeable scale, so there is nothing above
    /// this to move to. The Launch Pad at tier 3 of 3.
    ///
    /// <para>Deliberately NOT <see cref="LimitReached"/>. A cap that is full can
    /// be freed; a maximum tier cannot be exceeded by any action at all, and an
    /// operator reads those two differently.</para>
    /// </summary>
    AlreadyAtMaximum = 9,

    /// <summary>
    /// The command costs more than the funds on hand.
    ///
    /// <para>Was <see cref="Range"/>, which documents "an argument was out of
    /// its valid range" and is not what happened: affordability is not about an
    /// argument, and a client reading the enum name aloud got it wrong.</para>
    ///
    /// <para><see cref="CommandResult.Breach"/> carries the cost as
    /// <c>Actual</c> against the balance as <c>Limit</c>, so the client can say
    /// how short and in the operator's own currency rendering.</para>
    /// </summary>
    InsufficientFunds = 10,

    /// <summary>
    /// The command costs more science than is banked.
    /// <see cref="InsufficientFunds"/>'s twin, and separate for the same reason
    /// the game keeps <c>Currency</c> as three members: an operator short of
    /// science does something entirely different about it from one short of
    /// funds.
    ///
    /// <para>Authority: <c>CurrencyModifierQuery.RunQuery(reason, ...).CanAfford(Currency.Science)</c>,
    /// which is what <c>RDTech.ResearchTech</c> asks. NOT
    /// <c>ResearchAndDevelopment.CanAfford</c>, which skips the modifier chain
    /// and so answers a different question from the one the game acts on.</para>
    /// </summary>
    InsufficientScience = 11,

    /// <summary>
    /// The save is not a career save, so this command's whole subsystem does not
    /// exist here.
    ///
    /// <para>Authority: <c>HighLogic.CurrentGame.Mode</c>, and in practice the
    /// null <c>Instance</c> of the <c>ScenarioModule</c> that would have
    /// answered (<c>Funding</c>, <c>ContractSystem</c>, <c>StrategySystem</c>,
    /// <c>ResearchAndDevelopment</c>, <c>ScenarioUpgradeableFacilities</c>).</para>
    ///
    /// <para>This is a PERMANENT property of the save, not a state that may
    /// change, which is exactly what <see cref="ModeUnavailable"/> could not
    /// say. An operator should see the control absent rather than refused; a
    /// client that can tell this arm from the others can do that.</para>
    /// </summary>
    CareerModeRequired = 12,

    /// <summary>
    /// The game is in a scene this command cannot run from.
    ///
    /// <para>Authority: <c>HighLogic.LoadedScene</c> (<c>GameScenes</c>).
    /// <see cref="CommandResult.Detail"/> names the scene when the producer had
    /// one.</para>
    /// </summary>
    WrongScene = 13,

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
    /// <see cref="CommandResult.Detail"/> can carry the state in the game's own
    /// words.</para>
    /// </summary>
    WrongState = 14,

    /// <summary>
    /// Right command, wrong moment: the flight is not in a state that permits it
    /// yet, and will be later.
    ///
    /// <para>Authority: <c>FlightGlobals.ClearToSave()</c>, whose
    /// <c>ClearToSaveStatus</c> has seven named arms (in atmosphere, under
    /// acceleration, moving over the surface, about to crash, on a ladder,
    /// throttled up, orbit event imminent), plus
    /// <c>FlightDriver.CanRevertToPostInit</c>/<c>CanRevertToPrelaunch</c> and
    /// <c>GameParameters.Flight.CanLeaveToSpaceCenter</c>. The arm rides on
    /// <see cref="CommandResult.Detail"/>.</para>
    ///
    /// <para>Distinct from <see cref="WrongState"/>, which is about the entity
    /// and does not resolve by waiting.</para>
    /// </summary>
    NotClearToProceed = 15,

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
    CapabilityMismatch = 16,

    /// <summary>
    /// There is no usable link for what this command needs to send.
    ///
    /// <para>Authority: <c>ScienceUtil.GetBestTransmitter(Vessel)</c> and
    /// <c>IScienceDataTransmitter.CanTransmit()</c>. Deliberately NOT the
    /// Courier's own comms-loss gate, which refuses the dispatch before a
    /// handler ever runs; this is the vessel finding it has no antenna that can
    /// carry the payload.</para>
    /// </summary>
    NoConnection = 17,

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
    NotUnlocked = 18,

    /// <summary>
    /// Another vessel is on the launch site.
    ///
    /// <para>Authority: <c>PreFlightTests.LaunchSiteClear</c>, whose
    /// <c>GetWarningTitle()</c>/<c>GetWarningDescription()</c> are the game's own
    /// words for it and ride on <see cref="CommandResult.Detail"/>.</para>
    /// </summary>
    SiteOccupied = 19,

    /// <summary>
    /// The facility this command needs is destroyed or damaged.
    ///
    /// <para>Authority: <c>PreFlightTests.FacilityOperational</c>, over
    /// <c>PSystemSetup.Instance.GetSpaceCenterFacility(name).GetFacilityDamage()</c>.</para>
    /// </summary>
    FacilityDamaged = 20,

    /// <summary>
    /// The vehicle is not a launchable article yet: an install's build and
    /// logistics model has work outstanding on it. Nothing is over a limit and
    /// nothing is broken, the thing simply has not been made ready.
    ///
    /// <para>Authority: whichever Uplink CONTRIBUTED the readiness requirement
    /// that refused (see <see cref="IUplinkHost.AddCommandRequirement"/>), never
    /// a stock KSP read: stock has no build step, so it contributes no readiness
    /// requirements and this code never arrives on a stock install. Under RP-1 it
    /// is a vehicle that was never integrated, one still integrating, one
    /// finished but not rolled out, or one rolled out to a pad still being
    /// reconditioned. <see cref="CommandResult.Detail"/> says which.</para>
    ///
    /// <para>Deliberately NOT <see cref="LimitReached"/>, which is the launch
    /// refusal an operator already gets for a craft that is too heavy or too
    /// large for the site, and which is fixed by changing the craft or upgrading
    /// the pad. This one is fixed by doing the outstanding work, and the two
    /// want entirely different next moves.</para>
    ///
    /// <para>Deliberately NOT <see cref="NotFound"/> either, which
    /// <c>ksp.launch</c> already returns when no craft file answers to the name.
    /// A craft that exists on disk and has never been built is a different
    /// situation from one that does not exist, and collapsing them tells an
    /// operator to go looking for a file that is sitting right there.</para>
    /// </summary>
    NotReady = 21,

    /// <summary>
    /// The command consumes a countable ITEM and there are not enough of them
    /// aboard: an EVA repair kit for a repair, on a provider that charges one.
    ///
    /// <para>Authority: the provider's own charge, read back from the same
    /// function that STATES the cost on
    /// <see cref="ReliabilityPartEntry.RepairCost"/>. The two come from one
    /// place precisely so a console cannot show one number while the repair
    /// takes another, and the ITEM is always the provider's to name: this code
    /// never asserts which one, only that there were too few.</para>
    ///
    /// <para><see cref="InsufficientFunds"/>'s and
    /// <see cref="InsufficientScience"/>'s third sibling, and separate for the
    /// same reason those two are separate from each other: an operator short of
    /// a physical item does something entirely different about it from one
    /// short of a currency, and nothing can be bought to fix it.</para>
    ///
    /// <para>Deliberately NOT <see cref="LimitReached"/>, which is a capacity
    /// that is FULL. This is a store that is empty, and the two read as
    /// opposites.</para>
    /// </summary>
    InsufficientResource = 22,
}

/// <summary>
/// R7 Fix 1: the ONE result shape every command returns, replacing the three
/// hand-rolled records (<c>Ack</c>/<c>StageResult</c>/<c>AddManeuverNodeResult</c>)
/// that each re-declared <c>Success</c> + <c>ErrorCode</c>. <see cref="Success"/>
/// false pairs with a typed <see cref="ErrorCode"/> (never a free-text message a
/// client has to string-match), following a <c>Result&lt;T, CommandError&gt;</c>
/// ruling: results are always delivered (never a fire-and-forget void), and
/// failure is structured data, not a thrown exception.
///
/// <para>This non-generic base is the "no payload" case (every plain
/// actuation command: the former <c>Ack</c>). Commands that return a real
/// value use <see cref="CommandResult{T}"/>, whose <c>Payload</c> carries it
/// (<c>vessel.control.stage</c>'s new stage index, <c>vessel.maneuver.add</c>'s
/// created node id).</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
// AutoExportMethods=false: the static Ok/Fail factories are C#-side ergonomics,
// not wire shape: without this rtcli emits them as bogus interface members.
[TsInterface(AutoExportMethods = false)]
#endif
public class CommandResult
{
    [SitrepUnit(Units.Flag)]
    public bool Success { get; set; } = true;

    [SitrepUnit(Units.Enumeration)]
    public CommandErrorCode ErrorCode { get; set; } = CommandErrorCode.None;

    /// <summary>
    /// The numbers behind the refusal, when the refusal has any: the cap and the
    /// count, the tier and the top tier, the price and the balance. Null on
    /// success and on every refusal that is not a comparison.
    ///
    /// <para><see cref="ErrorCode"/> alone cannot say "16 of 16 active crew", and
    /// the code and the numbers only mean anything together: the code picks the
    /// sentence, this fills the gaps in it. Every number here was already in
    /// scope on the line that refused, and used to be discarded there.</para>
    ///
    /// <para>The SAME <see cref="LimitBreach"/> the declared-gate path carries on
    /// <see cref="GateVerdict.Breach"/>, deliberately, so an operator reads one
    /// sentence shape whether the refusal came from a gate or from an actuator
    /// that got far enough to look.</para>
    /// </summary>
    public LimitBreach? Breach { get; set; }

    /// <summary>
    /// The refusal in the GAME's own words, when the game had any: the arm of
    /// <c>ClearToSaveStatus</c> it came back with,
    /// <c>Strategies.Strategy.CanBeActivated(out string reason)</c>'s reason,
    /// <c>GameVariables.GetEVALockedReason</c>'s sentence, a
    /// <c>PreFlightTests.IPreFlightTest</c>'s <c>GetWarningTitle()</c>, a
    /// <c>[Description]</c>-tagged state member's name. Empty when the refusal
    /// had nothing to quote.
    ///
    /// <para>Interpolating what the game says beats inferring a cause from the
    /// mechanism that produced it, and it means this mod does not maintain an
    /// English table of KSP's own vocabulary that goes stale on every update and
    /// is wrong in every other language.</para>
    ///
    /// <para>Prose for a human, never parsed: <see cref="ErrorCode"/> is the
    /// machine-readable half and this is the readable one. The same split, and
    /// the same field name, as <see cref="GateVerdict.Detail"/>.</para>
    ///
    /// <para>Nullable rather than empty-defaulted, so it lands on the wire as an
    /// OPTIONAL property: an existing consumer that builds a
    /// <c>CommandResult</c> is not made to supply a field it has nothing to put
    /// in, which is what makes this additive rather than a Major.</para>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Detail { get; set; }

    public static CommandResult Ok() => new CommandResult { Success = true };

    public static CommandResult Fail(CommandErrorCode errorCode) =>
        new CommandResult { Success = false, ErrorCode = errorCode };

    /// <summary>A refusal that quotes the game. See <see cref="Detail"/>.</summary>
    public static CommandResult Fail(CommandErrorCode errorCode, string? detail) =>
        new CommandResult
        {
            Success = false,
            ErrorCode = errorCode,
            // Whitespace is not a sentence. An empty Detail on the wire would
            // render as a refusal that quoted the game and got nothing.
            Detail = string.IsNullOrWhiteSpace(detail) ? null : detail,
        };

    /// <summary>A refusal that carries its comparison. See <see cref="Breach"/>.</summary>
    public static CommandResult Fail(CommandErrorCode errorCode, LimitBreach breach) =>
        new CommandResult { Success = false, ErrorCode = errorCode, Breach = breach };
}

/// <summary>
/// R7 Fix 1: the payload-carrying result, <see cref="CommandResult"/> plus a
/// typed <see cref="Payload"/>. <c>vessel.control.stage</c> returns
/// <c>CommandResult&lt;int&gt;</c> (the new current stage index, rather than a
/// void fire-and-forget); <c>vessel.maneuver.add</c>
/// returns <c>CommandResult&lt;string&gt;</c> (the created node's opaque id,
/// O-6 fixed). <see cref="Payload"/> is default (null for reference types) when
/// <see cref="CommandResult.Success"/> is false.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
// AutoExportMethods=false: the static Ok/Fail factories are C#-side ergonomics,
// not wire shape: without this rtcli emits them as bogus interface members.
[TsInterface(AutoExportMethods = false)]
#endif
public class CommandResult<T> : CommandResult
{
    public T? Payload { get; set; }

    public static CommandResult<T> Ok(T payload) =>
        new CommandResult<T> { Success = true, Payload = payload };

    public static new CommandResult<T> Fail(CommandErrorCode errorCode) =>
        new CommandResult<T> { Success = false, ErrorCode = errorCode };

    /// <summary>A refusal that quotes the game. See <see cref="CommandResult.Detail"/>.</summary>
    public static new CommandResult<T> Fail(CommandErrorCode errorCode, string? detail) =>
        new CommandResult<T>
        {
            Success = false,
            ErrorCode = errorCode,
            Detail = string.IsNullOrWhiteSpace(detail) ? null : detail,
        };

    /// <summary>A refusal that carries its comparison. See <see cref="CommandResult.Breach"/>.</summary>
    public static new CommandResult<T> Fail(CommandErrorCode errorCode, LimitBreach breach) =>
        new CommandResult<T> { Success = false, ErrorCode = errorCode, Breach = breach };
}
