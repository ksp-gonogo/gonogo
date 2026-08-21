#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>time.calendar</c> channel payload: how long a day is, and a year,
/// as the RUNNING GAME defines them rather than as anyone assumed.
///
/// <para><b>Why this channel exists.</b> Every duration on the wire is SI
/// seconds, so any consumer that wants to say "3 days" has to divide by
/// something, and until this channel existed the only thing to divide by was a
/// constant compiled into the client: 21,600, one Kerbin rotation. That is
/// right for stock KSP on Kerbin time and wrong three ways otherwise.</para>
///
/// <list type="bullet">
/// <item><description><b>Stock, no mods.</b>
/// <c>GameSettings.KERBIN_TIME</c> is a real setting a player can turn off,
/// and KSP's own UI then reads in 24-hour days and 365-day years. A consumer
/// holding 21,600 disagrees with the game on the same screen.</description>
/// </item>
/// <item><description><b>A planet pack.</b> RSS and anything else built on
/// Kopernicus replaces <c>KSPUtil.dateTimeFormatter</c> outright, so a day
/// becomes 86,400s and a year 365 days. A client dividing by 21,600 reports
/// four times too many days, in a number that looks entirely
/// plausible.</description></item>
/// <item><description><b>Anything else.</b> The formatter is an interface with
/// a public setter; a mod can put any calendar behind it. Reading the numbers
/// off it is the only approach that does not need a list of which mods to know
/// about.</description></item>
/// </list>
///
/// <para><b>Where the values come from.</b> Straight off
/// <c>KSPUtil.dateTimeFormatter</c>, whose <c>Minute</c>, <c>Hour</c>,
/// <c>Day</c> and <c>Year</c> are each a count of SECONDS (confirmed by
/// decompiling <c>IDateTimeFormatter</c>). No arithmetic, no derivation, no
/// per-mod special case: whatever the game is using to print its own clock is
/// what this channel carries.</para>
///
/// <para><b>It can change mid-session</b>, which is why this is a channel and
/// not a one-shot descriptor like <c>system.units</c>. The KERBIN_TIME setting
/// is reachable from the in-game settings menu at any time.</para>
///
/// <para><b>Deliberately not derived here:</b> days-per-year. A consumer that
/// wants it divides <see cref="YearSeconds"/> by <see cref="DaySeconds"/>,
/// which is exact and needs no second field to keep in step. Publishing both
/// would create a pair that can disagree.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("time.calendar")]
public class TimeCalendar
{
    /// <summary>Seconds in one minute. 60 everywhere so far, carried because
    /// the formatter exposes it and assuming is what this channel exists to
    /// stop.</summary>
    [SitrepUnit(Units.Seconds)]
    public double MinuteSeconds { get; set; }

    /// <summary>Seconds in one hour.</summary>
    [SitrepUnit(Units.Seconds)]
    public double HourSeconds { get; set; }

    /// <summary>
    /// Seconds in one day: 21,600 on stock Kerbin time, 86,400 under Earth
    /// time or a planet pack.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double DaySeconds { get; set; }

    /// <summary>
    /// Seconds in one year: 9,201,600 on stock Kerbin time (426 days),
    /// 31,536,000 under a 365-day Earth calendar.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double YearSeconds { get; set; }

    /// <summary>
    /// The stock <c>GameSettings.KERBIN_TIME</c> flag, for a consumer that
    /// wants to LABEL the calendar rather than just measure with it ("Kerbin
    /// time" against "Earth time"). Not the source of truth for any
    /// arithmetic: the seconds fields above are, and they already account for
    /// this flag and for anything a planet pack did on top of it.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool KerbinTime { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
