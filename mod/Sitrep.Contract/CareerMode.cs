#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The game's save mode, mirroring KSP's <c>Game.Modes</c> — the ground-side
/// fact that decides which career surfaces (funds, tech tree, contracts,
/// strategies, facility upgrades) are even meaningful. Distinct from
/// <c>CareerStatus</c>: that payload is <c>null</c> in sandbox/science (no
/// <c>Funding</c>/<c>ContractSystem</c> to read), so it can't carry the mode —
/// a save can be in <see cref="Sandbox"/> or <see cref="Science"/> and still
/// need widgets to know which one. Hence <c>career.mode</c> is its OWN topic,
/// emitted in ALL modes.
///
/// <para>KSP's <c>Game.Modes</c> also has <c>SCENARIO</c>,
/// <c>SCENARIO_NON_RESUMABLE</c>, <c>MISSION</c> and <c>MISSION_BUILDER</c>;
/// none map to a distinct player-career surface, so
/// <c>Sitrep.Host.CareerViewProvider.ParseGameMode</c> folds them (and any
/// future KSP addition) into <see cref="Unknown"/> rather than the mapper
/// throwing. <c>SCIENCE_SANDBOX</c> maps to <see cref="Science"/>.</para>
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum GameMode
{
    Sandbox,
    Career,
    Science,
    Unknown,
}

/// <summary>
/// The <c>career.mode</c> channel payload — a single <see cref="GameMode"/>,
/// the active save's mode. Produced by
/// <c>Sitrep.Host.CareerViewProvider.BuildCareerMode</c>, which reads the raw
/// <c>Game.Modes.ToString()</c> string <c>Gonogo.KSP.KspHost</c> captures each
/// tick. The whole payload is <c>null</c> only when no game is loaded at all
/// (main menu / no save) — a "no data yet" absence, never a fabricated mode;
/// once a save is loaded the mode is always one of the four
/// <see cref="GameMode"/> members.
///
/// <para><b>Typing-only mirror.</b> This type reproduces the EXACT serialized
/// shape <c>CareerViewProvider.BuildCareerMode</c> emits (<c>{ "mode": &lt;int&gt; }</c>,
/// the enum's integer ordinal, matching every other enum in this codec — see
/// <c>Sitrep.Core.Serialization.JsonWriter</c>). It is a codegen marker, not
/// serialized itself.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("career.mode")]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CareerMode
{
    public GameMode Mode { get; set; }
}
