#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>game.dlc</c> channel payload — which KSP expansions ("DLC") are
/// installed, produced by <c>Sitrep.Host.SystemViewProvider.BuildGameDlc</c>.
/// This is the <c>Meta.Dlc</c> path: a ground-side, scene-independent game
/// fact (the install has the expansion or it doesn't), NOT a per-tick
/// capture flag. It lets a widget distinguish "the player has no DLC" from
/// "the DLC is present but nothing is deployed yet" — chiefly
/// <c>DeployedScience</c>, which reads Breaking Ground.
///
/// <para>Mirrors the exact serialized shape
/// <c>SystemViewProvider.BuildGameDlc</c> emits (a wrapper object
/// <c>{ "breakingGround": bool, "makingHistory": bool }</c>); it is a
/// typing/codegen marker so a widget resolves a real payload type instead of
/// <c>unknown</c>, and does NOT participate in serialization (the provider
/// emits the live value tree that <c>JsonWriter</c> walks — see
/// <see cref="SitrepTopicAttribute"/>). The whole payload is <c>null</c> (not
/// an all-false object) when no sample has landed yet — the provider's
/// "no data yet" vs. "DLC genuinely absent" distinction.</para>
///
/// <para>Same <c>game</c>/<c>system</c>-domain convention as
/// <see cref="SystemBodies"/>: no per-payload <c>Meta</c> field — its
/// <see cref="Meta"/> rides the envelope (<c>StreamData.Meta</c>), never the
/// payload body. This is a ground-side fact, so its Topic is
/// <c>DelayRole.TrueNow</c> — DLC presence is known independent of any
/// vessel's comms link.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("game.dlc")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class GameDlc
{
    /// <summary>Whether the Breaking Ground expansion ("Serenity") is installed — deployed science, robotics, surface features.</summary>
    public bool BreakingGround { get; set; }

    /// <summary>Whether the Making History expansion is installed — mission builder, extra parts.</summary>
    public bool MakingHistory { get; set; }
}
