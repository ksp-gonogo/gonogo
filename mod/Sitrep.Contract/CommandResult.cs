#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The typed, machine-readable failure code every command result carries —
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
/// older consumer doesn't recognise — the same <c>Unknown</c>-style
/// read-fallback convention every other enum in this contract uses.</para>
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum CommandErrorCode
{
    /// <summary>No error — the success sentinel, paired with <see cref="CommandResult.Success"/> = true.</summary>
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
}

/// <summary>
/// R7 Fix 1: the ONE result shape every command returns, replacing the three
/// hand-rolled records (<c>Ack</c>/<c>StageResult</c>/<c>AddManeuverNodeResult</c>)
/// that each re-declared <c>Success</c> + <c>ErrorCode</c>. <see cref="Success"/>
/// false pairs with a typed <see cref="ErrorCode"/> (never a free-text message a
/// client has to string-match) — the design doc §3's <c>Result&lt;T, CommandError&gt;</c>
/// ruling: results are always delivered (never a fire-and-forget void), and
/// failure is structured data, not a thrown exception.
///
/// <para>This non-generic base is the "no payload" case (every plain
/// actuation command — the former <c>Ack</c>). Commands that return a real
/// value use <see cref="CommandResult{T}"/>, whose <c>Payload</c> carries it
/// (<c>vessel.control.stage</c>'s new stage index, <c>vessel.maneuver.add</c>'s
/// created node id).</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CommandResult
{
    public bool Success { get; set; } = true;

    public CommandErrorCode ErrorCode { get; set; } = CommandErrorCode.None;

    public static CommandResult Ok() => new CommandResult { Success = true };

    public static CommandResult Fail(CommandErrorCode errorCode) =>
        new CommandResult { Success = false, ErrorCode = errorCode };
}

/// <summary>
/// R7 Fix 1: the payload-carrying result — <see cref="CommandResult"/> plus a
/// typed <see cref="Payload"/>. <c>vessel.control.stage</c> returns
/// <c>CommandResult&lt;int&gt;</c> (the new current stage index, unlike
/// Telemachus's <c>f.stage</c> void fire-and-forget); <c>vessel.maneuver.add</c>
/// returns <c>CommandResult&lt;string&gt;</c> (the created node's opaque id,
/// O-6 fixed). <see cref="Payload"/> is default (null for reference types) when
/// <see cref="CommandResult.Success"/> is false.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CommandResult<T> : CommandResult
{
    public T? Payload { get; set; }

    public static CommandResult<T> Ok(T payload) =>
        new CommandResult<T> { Success = true, Payload = payload };

    public static new CommandResult<T> Fail(CommandErrorCode errorCode) =>
        new CommandResult<T> { Success = false, ErrorCode = errorCode };
}
