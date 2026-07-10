#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One kOS CPU as it appears on the <c>kos.processors</c> channel — the
/// in-process replacement for the old telnet CPU-menu scrape
/// (<c>CPU_ROW_RE</c>/<c>MENU_HEADER</c>/<c>LIST_CHANGED</c>). Every field
/// is read off the public <c>kOSProcessor</c> members
/// (<c>kos-migration-spec.md</c> §5): <see cref="CoreId"/> = <c>KOSCoreId</c>
/// (stable-per-run), <see cref="Tag"/> = the <c>KOSNameTag</c> tag,
/// <see cref="HasBooted"/> = <c>HasBooted</c>, <see cref="BootFilePath"/> =
/// <c>BootFilePath</c> (stringified), <see cref="ProcessorMode"/> =
/// <c>ProcessorMode</c> (enum name).
///
/// <para>R7 typed-absence discipline: <see cref="Tag"/> and
/// <see cref="BootFilePath"/> are nullable — a CPU with no name-tag or no
/// boot file carries <c>null</c>, never a sentinel empty-string that a
/// consumer could mistake for a real (empty) tag.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("kos.processors", isArray: true)]
public class KosProcessorInfo
{
    /// <summary><c>kOSProcessor.KOSCoreId</c> — stable per game run, the handle every command targets.</summary>
    public int CoreId { get; set; }

    /// <summary><c>kOSProcessor.Tag</c> (from the companion <c>KOSNameTag</c>) — null when the part carries no name-tag.</summary>
    public string? Tag { get; set; }

    /// <summary><c>kOSProcessor.HasBooted</c> — false while the CPU is still running its boot script.</summary>
    public bool HasBooted { get; set; }

    /// <summary><c>kOSProcessor.BootFilePath</c>, stringified — null when no boot file is selected.</summary>
    public string? BootFilePath { get; set; }

    /// <summary><c>kOSProcessor.ProcessorMode</c> as its enum name (<c>READY</c>/<c>OFF</c>/<c>STARVED</c>).</summary>
    public string ProcessorMode { get; set; } = "";
}

/// <summary>
/// Out-of-band status for one centralised compute topic
/// (<c>kos.compute.&lt;id&gt;.status</c>) — the bits that don't fit the
/// value channel (<c>kos-migration-spec.md</c> §4.4). Mirrors the app-side
/// <c>useKosScriptStatus</c> shape: <see cref="Running"/> /
/// <see cref="LastGoodAt"/> / <see cref="ScriptError"/> /
/// <see cref="ParseError"/> / <see cref="Paused"/>.
///
/// <para>R7 typed-absence: <see cref="LastGoodAt"/> is a nullable UT
/// (<c>null</c> = never produced a good parse yet, never <c>0</c>/<c>-1</c>);
/// <see cref="ScriptError"/>/<see cref="ParseError"/> are null when there is
/// no error, never an empty string.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosComputeStatus
{
    /// <summary>The per-topic loop is currently dispatching this script on its CPU.</summary>
    public bool Running { get; set; }

    /// <summary>UT of the last successful <c>[KOSDATA]</c> parse — null until the first good parse.</summary>
    public double? LastGoodAt { get; set; }

    /// <summary>Last script-author fault (runtime exception / <c>[KOSERROR]</c>) — null when none.</summary>
    public string? ScriptError { get; set; }

    /// <summary>Last <c>[KOSDATA]</c> parse failure — null when none.</summary>
    public string? ParseError { get; set; }

    /// <summary>The per-topic breaker has tripped (three consecutive script faults) — dispatch is paused until <c>kos.reEnable</c>.</summary>
    public bool Paused { get; set; }
}

/// <summary>
/// Args for the <c>kos.exec</c> / <c>kos.dispatchNow</c> command — the
/// <c>RUNPATH</c> trigger (<c>kos-migration-spec.md</c> §4(a)). Names the
/// target CPU and the registered compute script to run. Delivered DELAYED,
/// single-owner (spec §3.0): reachability + the <c>HasBooted</c> /
/// <c>IsWaitingForCommand()</c> idle-prompt guard are re-checked at delivery,
/// on the KSP main thread.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosExecArgs
{
    /// <summary>Target CPU, identified by its <see cref="KosProcessorInfo.CoreId"/>.</summary>
    public int CoreId { get; set; }

    /// <summary>The registered compute topic id whose script to run (its on-volume path is <c>0:/widget_scripts/&lt;id&gt;.ks</c>).</summary>
    public string ScriptId { get; set; } = "";
}

/// <summary>
/// Args for the <c>kos.reEnable</c> command — re-arms one per-topic compute
/// breaker after it tripped (three consecutive script faults, spec §4.4 /
/// the app-side <c>reEnable</c> path).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosReEnableArgs
{
    /// <summary>The compute topic id whose breaker to clear.</summary>
    public string ScriptId { get; set; } = "";
}
