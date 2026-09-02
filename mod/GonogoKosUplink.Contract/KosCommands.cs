#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace Gonogo.KosUplink;

/// <summary>
/// One kOS CPU as it appears on the <c>kos.processors</c> channel. Every field
/// is read in-process off the public <c>kOSProcessor</c> members, never
/// scraped from a rendered terminal: <see cref="CoreId"/> = <c>KOSCoreId</c>
/// (stable-per-run), <see cref="Tag"/> = the <c>KOSNameTag</c> tag,
/// <see cref="HasBooted"/> = <c>HasBooted</c>, <see cref="BootFilePath"/> =
/// <c>BootFilePath</c> (stringified), <see cref="ProcessorMode"/> =
/// <c>ProcessorMode</c> (enum name).
///
/// <para>R7 typed-absence discipline: <see cref="Tag"/> and
/// <see cref="BootFilePath"/> are nullable, a CPU with no name-tag or no
/// boot file carries <c>null</c>, never a sentinel empty-string that a
/// consumer could mistake for a real (empty) tag.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("kos.processors", isArray: true)]
public class KosProcessorInfo
{
    /// <summary><c>kOSProcessor.KOSCoreId</c>: stable per game run, the handle every command targets.</summary>
    [SitrepUnit(Units.Id)]
    public int CoreId { get; set; }

    /// <summary><c>kOSProcessor.Tag</c> (from the companion <c>KOSNameTag</c>): null when the part carries no name-tag.</summary>
    [SitrepUnit(Units.Text)]
    public string? Tag { get; set; }

    /// <summary><c>kOSProcessor.HasBooted</c>: false while the CPU is still running its boot script.</summary>
    [SitrepUnit(Units.Flag)]
    public bool HasBooted { get; set; }

    /// <summary><c>kOSProcessor.BootFilePath</c>, stringified: null when no boot file is selected.</summary>
    [SitrepUnit(Units.Text)]
    public string? BootFilePath { get; set; }

    /// <summary><c>kOSProcessor.ProcessorMode</c> as its enum name (<c>READY</c>/<c>OFF</c>/<c>STARVED</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string ProcessorMode { get; set; } = "";

    /// <summary>The CPU part's display title (<c>kOSProcessor.part.partInfo.title</c>,
    /// e.g. "Probe Core"): null when the part or its info is unavailable. Lets the
    /// picker label a CPU by what it IS when it carries no name-tag, instead of a
    /// bare "CPU &lt;id&gt;".</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }
}

/// <summary>
/// Out-of-band status for one centralised compute topic
/// (<c>kos.compute.&lt;id&gt;.status</c>): the bits that don't fit the
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
#if SITREP_CODEGEN
[TsInterface]
#endif
public class KosComputeStatus
{
    /// <summary>The per-topic loop is currently dispatching this script on its CPU.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Running { get; set; }

    /// <summary>UT of the last successful <c>[KOSDATA]</c> parse, null until the first good parse.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LastGoodAt { get; set; }

    /// <summary>Last script-author fault (runtime exception / <c>[KOSERROR]</c>), null when none.</summary>
    [SitrepUnit(Units.Text)]
    public string? ScriptError { get; set; }

    /// <summary>Last <c>[KOSDATA]</c> parse failure: null when none.</summary>
    [SitrepUnit(Units.Text)]
    public string? ParseError { get; set; }

    /// <summary>The per-topic breaker has tripped (three consecutive script faults) and dispatch is paused. No command clears it: the re-arm half was never built.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Paused { get; set; }
}
