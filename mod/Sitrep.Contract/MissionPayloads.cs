using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Where one Making History mission objective stands, defined by this contract
/// rather than by KSP.
///
/// <para>KSP's mission graph has no per-objective state. A node is either
/// activated (the mission reached it) or not, and exactly one node is the
/// mission's active node, so this reduces those facts to the four outcomes an
/// operator reads. It is an ordinal on the wire and a closed union on the
/// client like every other enum in this contract.</para>
/// <internal>
/// Being ours, it needs no mirror test: nobody else owns its numbering.
/// Derived by Sitrep.Host.MakingHistoryViewProvider from the raw
/// hasBeenActivated / isActive facts the capture records.
/// </internal>
/// </summary>
/// <category>Missions</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum MissionObjectiveState
{
    /// <summary>The mission has not reached this objective yet.</summary>
    Pending,

    /// <summary>The mission is on this objective now: it is the mission's active node and the mission is still running.</summary>
    Active,

    /// <summary>The mission reached this objective and has moved past it, or ended successfully on it.</summary>
    Reached,

    /// <summary>The mission ended without success before this objective was met.</summary>
    Failed,
}

/// <summary>
/// One objective of a Making History mission, in mission-flow order.
/// </summary>
/// <category>Missions</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class MissionObjectiveEntry
{
    /// <summary>The objective's node id (a GUID string), stable for the life of the mission.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>What the objective asks for, localised, as the mission author wrote it.</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>The author's longer description of the objective. <c>null</c> when it has none.</summary>
    [SitrepUnit(Units.Text)]
    public string? Description { get; set; }

    /// <summary>Where the objective stands. <c>null</c> when the mission's state could not be read.</summary>
    [SitrepUnit(Units.Enumeration)]
    public MissionObjectiveState? State { get; set; }
}

/// <summary>
/// The <c>missions.active</c> channel payload: the Making History mission
/// that is running, or has just ended, in the current game. The whole payload
/// is <c>null</c> when there is no mission game, when no mission has been set
/// up, or when the expansion is not installed; read <c>game.dlc</c> to tell
/// the last from the others.
///
/// <para>A mission that has ended stays in the payload with
/// <see cref="Finished"/> true until the game leaves the mission, so a client
/// can show the outcome.</para>
///
/// <para>Every field except <see cref="Objectives"/> is <c>null</c> whenever
/// the raw value is absent or could not be read. Score fields are meaningful
/// only when <see cref="ScoreEnabled"/> is true: a mission author can switch
/// scoring off.</para>
/// <internal>
/// Typing-only mirror of
/// <c>Sitrep.Host.MakingHistoryViewProvider.BuildMissionStatus</c>; the wire is
/// written by JsonWriter walking its dictionary. Never run against a real
/// Making History install: the captures behind it are verified against the
/// decompiled Assembly-CSharp types only.
/// </internal>
/// </summary>
/// <category>Missions</category>
[SitrepContract]
[SitrepTopic("missions.active")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class MissionStatus
{
    /// <summary>The mission's title, localised.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>The title of the mission's active node, the stage the mission is on. <c>null</c> when it has no active node.</summary>
    [SitrepUnit(Units.Text)]
    public string? Phase { get; set; }

    /// <summary>Whether the mission has started.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Started { get; set; }

    /// <summary>Whether the mission has ended, in success or failure.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Finished { get; set; }

    /// <summary>Whether the mission ended in success. Meaningful once <see cref="Finished"/> is true.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Succeeded { get; set; }

    /// <summary>Whether the mission awards a score at all.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? ScoreEnabled { get; set; }

    /// <summary>The score earned so far.</summary>
    [SitrepUnit(Units.Count)]
    public double? Score { get; set; }

    /// <summary>The most score the mission can award.</summary>
    [SitrepUnit(Units.Count)]
    public double? MaxScore { get; set; }

    /// <summary>The mission's objectives in flow order, orphaned nodes left out. Empty when it has none.</summary>
    public List<MissionObjectiveEntry>? Objectives { get; set; }
}
