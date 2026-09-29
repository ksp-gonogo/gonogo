#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The game's save mode, from KSP's <c>Game.Modes</c>. It decides which career
/// surfaces (funds, tech tree, contracts, strategies, facility upgrades) mean
/// anything. <c>CareerStatus</c> is <c>null</c> outside career, so the mode is
/// its own Topic, <c>career.mode</c>, emitted in every mode.
///
/// <para>On the wire an enum is its integer ordinal: <c>Sandbox</c> 0,
/// <c>Career</c> 1, <c>Science</c> 2, <c>Unknown</c> 3.</para>
/// <internal>
/// Sitrep.Host.CareerViewProvider.ParseGameMode maps the raw Game.Modes name.
/// SCENARIO, SCENARIO_NON_RESUMABLE, MISSION, MISSION_BUILDER and any future
/// KSP addition fold into Unknown rather than the mapper throwing.
/// </internal>
/// </summary>
/// <category>Career</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum GameMode
{
    /// <summary>A sandbox save (<c>SANDBOX</c>): no funds, science or reputation.</summary>
    Sandbox,

    /// <summary>A career save (<c>CAREER</c>): funds, contracts, reputation and the tech tree all apply.</summary>
    Career,

    /// <summary>A science save (<c>SCIENCE_SANDBOX</c>): the tech tree and science apply, funds and contracts do not.</summary>
    Science,

    /// <summary>Any other KSP mode (a scenario or a mission), which has no player-career surface.</summary>
    Unknown,
}

/// <summary>
/// The <c>career.mode</c> channel payload: the active save's
/// <see cref="GameMode"/>, as <c>{ "mode": &lt;int&gt; }</c>. The whole payload
/// is <c>null</c> when no game is loaded (main menu, no save). Once a save is
/// loaded the mode is always one of the four <see cref="GameMode"/> members.
/// <internal>
/// Produced by Sitrep.Host.CareerViewProvider.BuildCareerMode from the raw
/// Game.Modes.ToString() string KspHost captures each tick. Typing-only mirror
/// of that shape; not serialized itself.
/// </internal>
/// </summary>
/// <category>Career</category>
[SitrepContract]
[SitrepTopic("career.mode")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CareerMode
{
    /// <summary>The active save's mode, as its integer ordinal.</summary>
    [SitrepUnit(Units.Enumeration)]
    public GameMode Mode { get; set; }
}
