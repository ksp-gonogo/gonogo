#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>time.calendar</c> channel payload: how long a minute, hour, day and
/// year are, and what real-world instant UT 0 is (when the game has one), as
/// the running game defines them.
///
/// <para>Every duration on the wire is SI seconds. To express one in days or
/// years, divide by these values rather than by a constant: 21,600 seconds per
/// day is right only for stock KSP on Kerbin time.</para>
///
/// <list type="bullet">
/// <item><description><b>Stock, no mods.</b>
/// <c>GameSettings.KERBIN_TIME</c> is a setting a player can turn off, and KSP's
/// own UI then reads in 24-hour days and 365-day years.</description></item>
/// <item><description><b>A planet pack.</b> RSS and anything else built on
/// Kopernicus replaces <c>KSPUtil.dateTimeFormatter</c>, so a day becomes
/// 86,400 s and a year 365 days. Dividing by 21,600 reports four times too many
/// days, in a number that looks plausible.</description></item>
/// <item><description><b>Anything else.</b> The formatter has a public setter,
/// so a mod can put any calendar behind it.</description></item>
/// </list>
///
/// <para>The values are read straight off <c>KSPUtil.dateTimeFormatter</c>,
/// whose <c>Minute</c>, <c>Hour</c>, <c>Day</c> and <c>Year</c> are each a count
/// of seconds: whatever the game uses to print its own clock is what this
/// channel carries.</para>
///
/// <para>It can change mid-session: the KERBIN_TIME setting is reachable from
/// the in-game settings menu at any time.</para>
///
/// <para>The whole payload is <c>null</c> when the calendar cannot be read or
/// any of the four durations is missing or not positive, so a consumer never
/// divides by zero. There is no days-per-year field: divide
/// <see cref="YearSeconds"/> by <see cref="DaySeconds"/>, which is exact.</para>
/// </summary>
/// <category>Game</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("time.calendar")]
public class TimeCalendar
{
    /// <summary>Seconds in one minute, as the game's date formatter defines it.
    /// 60 in every known calendar. Always positive.</summary>
    [SitrepUnit(Units.Seconds)]
    public double MinuteSeconds { get; set; }

    /// <summary>Seconds in one hour, as the game's date formatter defines it. Always positive.</summary>
    [SitrepUnit(Units.Seconds)]
    public double HourSeconds { get; set; }

    /// <summary>
    /// Seconds in one day: 21,600 on stock Kerbin time, 86,400 under Earth
    /// time or a planet pack. Always positive.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double DaySeconds { get; set; }

    /// <summary>
    /// Seconds in one year: 9,201,600 on stock Kerbin time (426 days),
    /// 31,536,000 under a 365-day Earth calendar. Always positive.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double YearSeconds { get; set; }

    /// <summary>
    /// The real-world instant UT 0 corresponds to, ISO-8601 in UTC
    /// (<c>1951-01-01T00:00:00Z</c>), or <c>null</c> when the running game has
    /// no such instant. Never an empty string.
    ///
    /// <para>The durations say how long a day is; this says which day it is.
    /// Every <c>Units.UniversalTime</c> field is an offset from UT 0, so with an
    /// epoch a deadline can be shown as <c>14 Mar 1957</c> rather than
    /// <c>Y3 D122</c>.</para>
    ///
    /// <para>It is read from the date formatter itself. Formatters that model a
    /// real calendar (RSSTimeFormatter, Kronometer) hold an anchor date; the
    /// stock formatter holds none.</para>
    ///
    /// <para><c>null</c> is the normal value, and it is not zero. Stock KSP has
    /// no real calendar: its own UI prints Year 1, Day 1, and so should every
    /// consumer. That holds for a planet pack too whenever no date-based
    /// formatter is installed alongside it. Do not render a default anchor for
    /// those games.</para>
    /// <internal>
    /// The anchor lives in a private DateTime field on those formatters and is
    /// read by reflection, the same way a career mod's own date utilities do.
    /// Nothing here knows which mod is installed.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Epoch { get; set; }

    /// <summary>
    /// The stock <c>GameSettings.KERBIN_TIME</c> flag, for a consumer that
    /// wants to label the calendar ("Kerbin time" against "Earth time"). Do
    /// not do arithmetic with it: the seconds fields above already account for
    /// this flag and for anything a planet pack did on top of it.
    /// <c>true</c> when the setting cannot be read.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool KerbinTime { get; set; }

    /// <summary>Payload provenance. <c>Source</c> is always <c>"game"</c>: the calendar describes the session, not a craft.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
