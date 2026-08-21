#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The typed, machine-readable failure code every command result carries,
/// R7 Fix 1's replacement for the bare <c>string</c> error codes
/// (<c>"E_RANGE"</c>/<c>"E_NOT_FOUND"</c>/<c>"E_MODE_UNAVAILABLE"</c>/
/// <c>"E_NO_VESSEL"</c>) the three hand-rolled result records used to return.
/// A string code is a Telemachus habit: it forces the client to string-match
/// a magic value that the compiler can neither check nor enumerate. This enum
/// makes the failure surface a closed, typed set instead.
///
/// <para><see cref="None"/> is the success sentinel (paired with
/// <see cref="CommandResult.Success"/> = true); <see cref="Unknown"/> is the
/// forward-compatible fallback for any code a newer producer emits that an
/// older consumer doesn't recognise: the same <c>Unknown</c>-style
/// read-fallback convention every other enum in this contract uses.</para>
/// </summary>
#if NETSTANDARD2_0
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
}

/// <summary>
/// R7 Fix 1: the ONE result shape every command returns, replacing the three
/// hand-rolled records (<c>Ack</c>/<c>StageResult</c>/<c>AddManeuverNodeResult</c>)
/// that each re-declared <c>Success</c> + <c>ErrorCode</c>. <see cref="Success"/>
/// false pairs with a typed <see cref="ErrorCode"/> (never a free-text message a
/// client has to string-match), the design doc §3's <c>Result&lt;T, CommandError&gt;</c>
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
#if NETSTANDARD2_0
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

    public static CommandResult Ok() => new CommandResult { Success = true };

    public static CommandResult Fail(CommandErrorCode errorCode) =>
        new CommandResult { Success = false, ErrorCode = errorCode };

    /// <summary>A refusal that carries its comparison. See <see cref="Breach"/>.</summary>
    public static CommandResult Fail(CommandErrorCode errorCode, LimitBreach breach) =>
        new CommandResult { Success = false, ErrorCode = errorCode, Breach = breach };
}

/// <summary>
/// R7 Fix 1: the payload-carrying result, <see cref="CommandResult"/> plus a
/// typed <see cref="Payload"/>. <c>vessel.control.stage</c> returns
/// <c>CommandResult&lt;int&gt;</c> (the new current stage index, unlike
/// Telemachus's <c>f.stage</c> void fire-and-forget); <c>vessel.maneuver.add</c>
/// returns <c>CommandResult&lt;string&gt;</c> (the created node's opaque id,
/// O-6 fixed). <see cref="Payload"/> is default (null for reference types) when
/// <see cref="CommandResult.Success"/> is false.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
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

    /// <summary>A refusal that carries its comparison. See <see cref="CommandResult.Breach"/>.</summary>
    public static new CommandResult<T> Fail(CommandErrorCode errorCode, LimitBreach breach) =>
        new CommandResult<T> { Success = false, ErrorCode = errorCode, Breach = breach };
}
