using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Where one Making History mission objective stands, worked out from how far
/// the mission has progressed.
///
/// <para>On the wire it is an integer ordinal.</para>
/// <internal>
/// KSP's mission graph has no per-objective state. A node is either activated
/// (the mission reached it) or not, and exactly one node is the mission's
/// active node, so this reduces those facts to the four outcomes an operator
/// reads.
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

    /// <summary>The mission is on this objective now and is still running. Once the mission ends, the objective it ended on is <see cref="Reached"/> or <see cref="Failed"/> instead.</summary>
    Active,

    /// <summary>The mission reached this objective and has moved past it, or ended successfully on it.</summary>
    Reached,

    /// <summary>The mission ended without success before this objective was met.</summary>
    Failed,
}

/// <summary>
/// One objective of a Making History mission. A mission is a flow chart of nodes,
/// each node a step that leads to the next, and each objective is one node.
/// Objectives are listed in the order the flow chart leads through them.
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
/// The Making History mission
/// that is running, or has just ended, in the current game. The whole payload
/// is <c>null</c> when there is no mission game, when no mission has been set
/// up, or when the expansion is not installed. The <c>game.dlc</c> Topic
/// (<see cref="GameDlc"/>) says only whether the expansion is installed; with it
/// installed, a <c>null</c> payload is one of the other two, and nothing on the
/// stream says which. A <c>null</c>
/// payload reaches a widget as a reading whose <c>state</c> is <c>"absent"</c>
/// and which carries no value, so test the state rather than the value for
/// <c>null</c>.
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
/// <categoryDescription>
/// A Making History mission in the current game: whether one is running and how far
/// each of its objectives has got.
/// </categoryDescription>
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

    /// <summary>The title of the mission's active node, the step of the mission's flow chart the mission is on now. <c>null</c> when it has no active node.</summary>
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

    /// <summary>The mission's objectives in the order its flow chart leads through them. A node that nothing in the flow chart leads to is left out. Empty when it has none.</summary>
    public List<MissionObjectiveEntry> Objectives { get; set; } = new();
}
