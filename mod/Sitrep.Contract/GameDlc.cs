#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>game.dlc</c> Topic payload: which KSP expansions ("DLC") are
/// installed. A fact about the install, independent of scene, so a widget can
/// tell "the player has no DLC" from "the DLC is present but nothing is
/// deployed yet" (deployed science, for instance, needs Breaking Ground).
///
/// <para>The whole payload is <c>null</c>, not an all-false object, when no
/// sample has been taken yet, so "no data yet" and "DLC absent" stay
/// distinct. A widget sees that <c>null</c> as a reading whose <c>state</c> is
/// <c>"absent"</c> and which carries no value. This is a fact about the
/// ground, so it is never delayed by any vessel's comms link (its delay role is
/// <c>TrueNow</c>; see the delay and vantage page).</para>
/// <internal>
/// Typing-only mirror of Sitrep.Host.SystemViewProvider.BuildGameDlc's shape;
/// the provider emits the value tree JsonWriter walks.
/// </internal>
/// </summary>
/// <category>Game</category>
[SitrepContract]
[SitrepTopic("game.dlc")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class GameDlc
{
    /// <summary>Whether the Breaking Ground expansion is installed: deployed science, robotics and surface features.</summary>
    [SitrepUnit(Units.Flag)]
    public bool BreakingGround { get; set; }

    /// <summary>Whether the Making History expansion is installed: the mission builder and extra parts.</summary>
    [SitrepUnit(Units.Flag)]
    public bool MakingHistory { get; set; }
}
