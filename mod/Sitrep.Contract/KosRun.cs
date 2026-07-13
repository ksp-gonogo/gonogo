#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// Args for the <c>kos.run</c> command — the general-purpose in-process
/// replacement for the standalone telnet proxy's ad-hoc RUNPATH path
/// (<c>kos-uplink-full-migration.md</c>). Unlike <see cref="KosExecArgs"/>
/// (which triggers a fixed, pre-registered compute topic script by id), this
/// carries the WHOLE literal command text to type into the CPU's REPL —
/// exactly what the app already builds client-side for the telnet path
/// (a bare <c>RUNPATH("path", args...).</c> line, or the multi-line managed-
/// sync wrapper from <c>packages/app/src/dataSources/kosWrapper.ts</c>). The
/// mod does not parse or interpret <see cref="Command"/> at all — it types it
/// into the interpreter exactly like <c>kos.keystroke</c> types terminal
/// input, via the same <c>TermWindow.ProcessOneInputChar</c> seam.
///
/// <para>Delivered DELAYED, single-in-flight-per-CPU (spec §3.0):
/// reachability + the <c>HasBooted</c>/<c>IsWaitingForCommand()</c> idle-
/// prompt guard are re-checked at delivery on the KSP main thread, mirroring
/// <see cref="KosExecArgs"/>. A second <c>kos.run</c> for a CPU that already
/// has one in flight is rejected with <c>CommandErrorCode.ModeUnavailable</c>
/// — the caller (mirroring <c>KosComputeSession</c>'s existing per-CPU FIFO
/// queue) is expected to serialize calls to the same CPU client-side.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosRunArgs
{
    /// <summary>Target CPU, identified by its <see cref="KosProcessorInfo.CoreId"/>.</summary>
    public int CoreId { get; set; }

    /// <summary>
    /// Caller-generated, per-call opaque correlation token. Echoed back
    /// verbatim on the matching <see cref="KosRunResult"/> so a client with
    /// several in-flight (different-CPU) calls can tell results apart —
    /// same role as <see cref="KosTerminalOpenArgs.LeaseToken"/>, but scoped
    /// to a single request/response instead of a session.
    /// </summary>
    public string RequestId { get; set; } = "";

    /// <summary>
    /// The literal text to type into the CPU's REPL, terminated the same way
    /// a human would press Enter (a trailing <c>\n</c> or <c>.\n</c>). Never
    /// parsed or rewritten by the mod.
    /// </summary>
    public string Command { get; set; } = "";
}

/// <summary>
/// Result of one <c>kos.run</c> dispatch, delivered on the
/// <c>kos.run.&lt;coreId&gt;</c> dynamic channel
/// (<c>Delivery.ReliableOrdered</c>, <c>DelayRole.Delayed</c> — same posture
/// as <see cref="KosTerminalFrame"/>: this is vessel telemetry riding
/// gonogo's reveal clock). Published exactly once per armed request, the
/// moment the mod's <c>[KOSDATA]</c>/<c>[KOSERROR]</c> block-capture pipeline
/// (<c>KosComputeAccumulator</c>/<c>KosDataParser</c> — the same one that
/// feeds <c>kos.compute.*</c>) completes a block for that CPU while the
/// request is still armed.
///
/// <para>R7 typed-absence: exactly one of <see cref="Fields"/> /
/// <see cref="Error"/> is non-null — a successful <c>[KOSDATA]</c> parse
/// carries <see cref="Fields"/> with <see cref="Error"/> null; an explicit
/// script-author <c>[KOSERROR]</c> carries <see cref="Error"/> with
/// <see cref="Fields"/> null. Field VALUES keep the exact
/// <c>KosDataParser.Coerce</c> shape (bool / double / string) the telnet
/// path already produces — no re-typing on the wire.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosRunResult
{
    /// <summary>The emitting CPU's <see cref="KosProcessorInfo.CoreId"/>.</summary>
    public int CoreId { get; set; }

    /// <summary>Echoes the triggering <see cref="KosRunArgs.RequestId"/>.</summary>
    public string RequestId { get; set; } = "";

    /// <summary>Parsed <c>[KOSDATA]</c> field map — null on an error result.</summary>
    public Dictionary<string, object?>? Fields { get; set; }

    /// <summary>Explicit <c>[KOSERROR]</c> message — null on a data result.</summary>
    public string? Error { get; set; }
}
