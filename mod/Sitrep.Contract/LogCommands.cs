#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// Ask for the mod's most recent log lines. Args for <c>system.log.recent</c>: how many of the newest
/// <c>[Gonogo]</c> lines the game logged to <c>KSP.log</c> to return, so a bug
/// report can carry them. Lines are returned with file paths, IP addresses and
/// share codes already replaced.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("system.log.recent", Payload = typeof(RecentLog), Delay = DelayRole.TrueNow, Summary = "The mod's most recent log lines, with paths and addresses removed.")]
public class RecentLogArgs
{
    /// <summary>
    /// The most lines to return. The mod keeps a few hundred; asking for more
    /// returns what it has. Zero or negative returns none.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int MaxLines { get; set; } = 200;
}

/// <summary>
/// The newest <c>[Gonogo]</c> lines the game logged, oldest first, as
/// <c>system.log.recent</c> returns them. Empty when the mod has logged nothing
/// since it started. Each line has had file paths, IP addresses, peer ids and
/// share codes replaced, so it is safe to post publicly.
/// </summary>
/// <category>System</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RecentLog
{
    /// <summary>The lines, oldest first.</summary>
    [SitrepUnit(Units.Text)]
    public List<string> Lines { get; set; } = new();

    /// <summary>
    /// How many lines the mod has kept since it started, counting those it has
    /// since let go of, which is also the number of the last of
    /// <see cref="Lines"/>. A caller that keeps the previous reply's count can
    /// tell which lines are new and how many it missed. Starts again from zero
    /// when the game restarts.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int Total { get; set; }
}
