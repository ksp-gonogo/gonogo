#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// The <c>gameAlarmClock</c> capability: the game's own alarm clock, read and
/// written for Gonogo. Resolve it through <see cref="IUplinkHost.Kernel"/> as an
/// <see cref="IGameAlarmClock"/>.
///
/// <para>Exclusive, and Gonogo registers KSP's stock Alarm Clock as the
/// vanilla. An install whose clock is absent publishes no game alarms and
/// Gonogo's own alarms work as before.</para>
/// </summary>
/// <category>Host and Kernel</category>
public static class GameAlarmClockCapability
{
    /// <summary>The capability id, <c>"gameAlarmClock"</c>.</summary>
    public const string Id = "gameAlarmClock";
}

/// <summary>
/// One alarm held by the game's alarm clock, as a provider reports it.
/// </summary>
/// <category>Host and Kernel</category>
public sealed class GameAlarmRecord
{
    /// <summary>The clock's own id for the alarm, unique within the save.</summary>
    public long Id { get; set; }

    /// <summary>What kind of event the clock computes the alarm's time from.</summary>
    public GameAlarmKind Kind { get; set; } = GameAlarmKind.Other;

    /// <summary>The alarm's title as the game shows it.</summary>
    public string Title { get; set; } = "";

    /// <summary>The universal time the alarm is due, as the clock holds it now.</summary>
    public double Ut { get; set; }

    /// <summary>
    /// The craft the alarm belongs to, as its guid (<c>Vessel.id</c>), or null
    /// for an alarm on no craft or on a craft that no longer exists.
    /// </summary>
    public string? Vessel { get; set; }

    /// <summary>What the game does to time warp when the alarm comes due.</summary>
    public GameAlarmWarp Warp { get; set; } = GameAlarmWarp.StopWarp;

    /// <summary>Whether the alarm has come due.</summary>
    public bool Triggered { get; set; }
}

/// <summary>
/// The game's alarm clock: what it holds, and the two edits Gonogo makes to it.
///
/// <para>Every member is main-thread only.</para>
/// </summary>
/// <category>Host and Kernel</category>
public interface IGameAlarmClock : ISitrepProvider
{
    /// <summary>
    /// Whether the clock exists in the current scene. False in a scene the game
    /// runs no clock in, such as the editor or the main menu; every other
    /// member then reports nothing and changes nothing.
    /// </summary>
    bool Available { get; }

    /// <summary>Every alarm the clock holds, in no particular order. Empty while <see cref="Available"/> is false.</summary>
    IReadOnlyList<GameAlarmRecord> Alarms();

    /// <summary>
    /// Adds an alarm due at <paramref name="ut"/> that leaves time warp alone
    /// and removes itself once it has come due.
    /// </summary>
    /// <param name="title">The title the game shows.</param>
    /// <param name="ut">The universal time it is due.</param>
    /// <returns>The new alarm's id, or null when the clock refused it or is not available.</returns>
    long? CreateAtUt(string title, double ut);

    /// <summary>Removes the alarm with this id. False when the clock holds no such alarm.</summary>
    bool Delete(long id);
}

/// <summary>
/// What kind of event the game's alarm clock computes an alarm's time from.
/// </summary>
/// <category>Alarms</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum GameAlarmKind
{
    /// <summary>A universal time the player chose, with or without a craft named on it.</summary>
    Time,

    /// <summary>A transfer window between two bodies, from their orbits alone.</summary>
    TransferWindow,

    /// <summary>A craft leaving or entering a sphere of influence on its current trajectory.</summary>
    SoiChange,

    /// <summary>A craft's next apoapsis.</summary>
    Apoapsis,

    /// <summary>A craft's next periapsis.</summary>
    Periapsis,

    /// <summary>A craft's next maneuver node.</summary>
    Maneuver,

    /// <summary>A kind this version of Gonogo does not know, such as one another mod adds.</summary>
    Other,
}

/// <summary>What the game does to time warp when one of its alarms comes due.</summary>
/// <category>Alarms</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum GameAlarmWarp
{
    /// <summary>Leaves time warp alone.</summary>
    Nothing,

    /// <summary>Stops time warp.</summary>
    StopWarp,

    /// <summary>Stops time warp and pauses the game.</summary>
    Pause,
}

/// <summary>
/// One alarm in the game's own alarm clock, as Gonogo shows it.
///
/// <para>An alarm whose time the game works out from a craft's live state (a
/// sphere of influence change, an apsis, a maneuver node) is a prediction made
/// from that craft, so it travels like that craft's telemetry: it is on
/// <c>alarm.game.craft.&lt;guid&gt;.list</c>, reaches each command centre one
/// signal delay after the craft, and stays at its last known state while the
/// craft is out of contact. Every other alarm is on <c>alarm.game.list</c> and
/// reaches every command centre at once.</para>
/// </summary>
/// <category>Alarms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class GameAlarm
{
    /// <summary>The game's own id for the alarm, which <c>alarm.game.delete</c> takes.</summary>
    [SitrepUnit(Units.Id)]
    public long Id { get; set; }

    /// <summary>What kind of event the game computes the alarm's time from.</summary>
    [SitrepUnit(Units.Enumeration)]
    public GameAlarmKind Kind { get; set; } = GameAlarmKind.Other;

    /// <summary>The alarm's title as the game shows it.</summary>
    [SitrepUnit(Units.Text)]
    public string Title { get; set; } = "";

    /// <summary>The universal time the alarm is due.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    /// <summary>
    /// The craft the alarm belongs to, as <c>"vessel:&lt;guid&gt;"</c>, or null
    /// for an alarm on no craft.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Vessel { get; set; }

    /// <summary>What the game does to time warp when the alarm comes due. Gonogo does not act on it.</summary>
    [SitrepUnit(Units.Enumeration)]
    public GameAlarmWarp Warp { get; set; } = GameAlarmWarp.StopWarp;

    /// <summary>Whether the alarm has come due.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Triggered { get; set; }

    /// <summary>
    /// The <see cref="ScetAlarm.Id"/> of the Gonogo alarm this game alarm was
    /// made for, or null for an alarm the player made in the game. A row with
    /// an id here is the same alarm as that Gonogo alarm, so show it once.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? GonogoId { get; set; }
}

/// <summary>
/// The game's alarm clock as every command centre sees it at once: the
/// <c>alarm.game.list</c> Topic.
///
/// <para>Holds only the alarms whose time is not worked out from a craft (see
/// <see cref="GameAlarm"/>).</para>
/// </summary>
/// <category>Alarms</category>
[SitrepContract]
[SitrepTopic("alarm.game.list")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class GameAlarmList
{
    /// <summary>
    /// Whether the game is running an alarm clock in the current scene. While
    /// false, <see cref="Alarms"/> is empty and Gonogo's own alarms are not
    /// copied into the game.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Available { get; set; }

    /// <summary>The alarms, in order of the time they are due.</summary>
    public List<GameAlarm> Alarms { get; set; } = new();
}

/// <summary>
/// Removes one alarm from the game's alarm clock, addressed by
/// <see cref="GameAlarm.Id"/>.
///
/// <para>Never delayed: it edits the player's clock and nothing aboard a
/// craft. Removing an alarm made for a Gonogo alarm removes that Gonogo alarm
/// too.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("alarm.game.delete", Delay = DelayRole.TrueNow)]
public class GameAlarmDeleteArgs
{
    /// <summary>The <see cref="GameAlarm.Id"/> of the alarm to remove.</summary>
    [SitrepUnit(Units.Id)]
    public long Id { get; set; }
}
