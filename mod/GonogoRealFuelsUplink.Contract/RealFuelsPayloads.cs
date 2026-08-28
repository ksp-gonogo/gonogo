#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using Sitrep.Contract;

namespace GonogoRealFuelsUplink;

// ─────────────────────────────────────────────────────────────────────────────
// RealFuels Topic payloads.
//
// Two questions decide whether a burn happens under Realism Overhaul, and
// nothing else on this wire answers either: can this engine be lit again, and
// is the propellant settled against the tank outlet. Both are RealFuels
// mechanics with no stock analogue.
//
// This Uplink models NEITHER reliability NOR failure. TestFlight owns that, and
// RealFuels has no failure model of its own: RF_TestFlight_UISupport.cfg copies
// TestFlight's reliability numbers into RealFuels CONFIG nodes purely so
// RealFuels' own editor UI can display them. The two answer different
// questions, so nothing here duplicates GonogoTestFlightUplink.
//
// Typing-only, like every other Uplink payload file: the uplink hand-builds the
// dict and JsonWriter walks that live tree, so these POCOs never serialize.
// They exist to give the client a generated type and to carry the [SitrepUnit]
// tokens the runtime hydration map is built from.
//
// Names are gonogo's vocabulary, not RealFuels' internals: `ignitionsRemaining`
// not `ignitions`, `ignitionProbability` not `GetUllageProbability`.
//
// ABSENCE. Every field is nullable and every one of them means it. An engine
// whose ignition budget could not be read carries null, never 0: 0 is a real
// and much worse claim under this mod (see IgnitionsRemaining), and a
// substituted one would tell an operator their upper stage is dead on the pad.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// One RealFuels engine on the <c>realfuels.engines</c> channel: its ignition
/// budget, its ullage state and the two rated figures that bound a burn.
///
/// <para>Read off the live <c>RealFuels.ModuleEnginesRF</c> and its
/// <c>UllageSet</c> by runtime reflection (RealFuels is GPLv3; the Uplink never
/// links its assembly, see <c>GonogoRealFuelsUplink.csproj</c>'s header).</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class RealFuelsEngineEntry
{
    /// <summary>The engine part's stable flight id, so a consumer can join this
    /// row to the same part on <c>vessel.parts</c>.</summary>
    [SitrepUnit(Units.Id)]
    public long? PartId { get; set; }

    /// <summary>The engine part's display title.</summary>
    [SitrepUnit(Units.Text)]
    public string? PartName { get; set; }

    /// <summary>
    /// Ignitions left in the budget, RAW: the live counter RealFuels decrements
    /// on each successful light.
    ///
    /// <para>It is NOT a plain count, and reading it as one is the mistake this
    /// Uplink exists to prevent. RealFuels overloads the value three ways:
    /// a positive number is a real budget, <c>-1</c> means unlimited, and
    /// <c>0</c> means the engine can be lit ONLY on the pad with a launch clamp
    /// attached (<c>ModuleEnginesRF.IgnitionUpdate</c> refuses the light
    /// otherwise). Telling an operator "0 ignitions" and telling them
    /// "ground ignition only" are the same wire value and opposite briefings.
    /// </para>
    ///
    /// <para>Consumers should read <see cref="IgnitionsUnlimited"/> and
    /// <see cref="GroundIgnitionOnly"/> rather than re-deriving the rule, and
    /// should show this number only when both are false.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? IgnitionsRemaining { get; set; }

    /// <summary>
    /// This engine can be relit without limit. True when the budget is negative
    /// (RealFuels' unlimited sentinel) or when the game-wide ignition limit is
    /// switched off, mirroring <c>ModuleEnginesRF.GetUllageIgnition</c>'s own
    /// first branch.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? IgnitionsUnlimited { get; set; }

    /// <summary>
    /// This engine will light only while the vessel is on a launch clamp: the
    /// <c>ignitions == 0</c> reading, which RealFuels renders as "ground support
    /// clamps" rather than as a spent budget. An engine in this state has no
    /// in-flight relight at all, which is a stronger claim than a low count.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? GroundIgnitionOnly { get; set; }

    /// <summary>
    /// The part's <c>literalZeroIgnitions</c> flag, from its engine-config
    /// module.
    ///
    /// <para>It is what decides which of the two meanings a configured
    /// <c>0</c> carries: <c>EngineConfigTechLevels.ConfigIgnitions</c> rewrites
    /// a config's 0 to the unlimited sentinel UNLESS the part sets this, in
    /// which case the 0 survives as a real ground-only budget. The normalisation
    /// happens on the way into the live module, so
    /// <see cref="GroundIgnitionOnly"/> is already unambiguous; this travels so
    /// a consumer can say WHY an engine is ground-only rather than merely that
    /// it is. Null when the part carries no engine-config module.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? LiteralZeroIgnitions { get; set; }

    /// <summary>Whether this engine is subject to ullage at all. A pressure-fed
    /// or hypergolic-settled engine is not, and its stability reading is
    /// therefore absent rather than perfect.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? UllageModelled { get; set; }

    /// <summary>
    /// Propellant settling, 0..1, from RealFuels' own ullage simulation. Its
    /// bands are 0.996 very stable, 0.95 stable, 0.75 risky, 0.30 very risky,
    /// 0.15 unstable, below that very unstable. Null when the engine models no
    /// ullage or the simulation has not run.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? UllageStability { get; set; }

    /// <summary>
    /// The chance this engine survives an ignition attempt at the current
    /// settling, 0..1: RealFuels rolls against exactly this number each frame a
    /// running ullage-subject engine is throttled up, and a failed roll is a
    /// flameout. Derived from <see cref="UllageStability"/> by RealFuels' own
    /// stability exponent, so it is not a restatement of it.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? IgnitionProbability { get; set; }

    /// <summary>Whether the engine needs pressurised feed rather than a pump.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? PressureFed { get; set; }

    /// <summary>
    /// Whether the tanks feeding a pressure-fed engine are pressurised enough to
    /// run it. Always true for a pumped engine, which has no feed-pressure
    /// requirement to fail.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? FeedPressureOk { get; set; }

    /// <summary>
    /// Total burn time the engine is rated for before it is running on borrowed
    /// life. Null when the config states none (RealFuels carries <c>-1</c> for
    /// "unrated", which is an absence and not a negative duration).
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? RatedBurnTimeSeconds { get; set; }

    /// <summary>
    /// The longest single burn the engine is rated for, where that is shorter
    /// than <see cref="RatedBurnTimeSeconds"/>. Null when the config states
    /// none.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? RatedContinuousBurnTimeSeconds { get; set; }

    /// <summary>
    /// The fraction of a tank's load RealFuels expects to be left unburnable
    /// when this engine flames out, 0..1. It is propellant that is loaded, paid
    /// for and unavailable, so a circularisation planned against the full load
    /// is planned against propellant that will not arrive.
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? PredictedMaximumResiduals { get; set; }
}

/// <summary>
/// The <c>realfuels.engines</c> channel: every RealFuels engine on the active
/// vessel, under the two game-wide switches that decide whether their readings
/// bind.
///
/// <para>The switches travel with the rows rather than on a channel of their
/// own because they change what a row MEANS: with
/// <see cref="IgnitionsLimited"/> off, every budget on the vessel is moot and
/// an operator reading "2 left" would be reading a limit the game is not
/// enforcing.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("realfuels.engines")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class RealFuelsEngines
{
    /// <summary>Whether the game is enforcing ignition budgets at all
    /// (RealFuels' <c>limitedIgnitions</c> setting).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? IgnitionsLimited { get; set; }

    /// <summary>Whether the game is simulating ullage at all (RealFuels'
    /// <c>simulateUllage</c> setting). With it off, a poor stability reading
    /// costs nothing.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? UllageSimulated { get; set; }

    /// <summary>The engines, in part order. An EMPTY list is a vessel with no
    /// RealFuels engines on it; a NULL list is a vessel the Uplink could not
    /// read. The two are different and are kept different.</summary>
    public RealFuelsEngineEntry[]? Engines { get; set; }
}

/// <summary>
/// The <c>realfuels.boiloff</c> channel: cryogenic propellant leaving the
/// vessel through the tank walls, which is what bounds a coast before a
/// circularisation.
/// </summary>
[SitrepContract]
[SitrepTopic("realfuels.boiloff")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public sealed class RealFuelsBoiloff
{
    /// <summary>
    /// Mass boiling off across every cryogenic tank on the vessel, as a RATE.
    ///
    /// <para>RealFuels' own <c>ModuleFuelTanks.BoiloffMassRate</c> is misnamed
    /// and is not this: it is the mass ACCUMULATED over the physics interval
    /// just past (<c>CalculateTankBoiloff</c> multiplies by the interval before
    /// adding, and the one branch of it that does divide back out feeds a
    /// different property). This
    /// Uplink divides the vessel total by the same interval RealFuels itself was
    /// handed, so what reaches the wire is a true rate and the field name is
    /// honest. Null when that interval is unavailable, never a zero: a rate
    /// divided by an unknown is not a rate of nothing.</para>
    /// </summary>
    [SitrepUnit(Units.KilogramsPerSecond)]
    public double? BoiloffRate { get; set; }

    /// <summary>
    /// How many tanks on the vessel can boil off at all. Zero is a real and
    /// useful answer (a hypergolic stack has no cryogenic tanks and will never
    /// boil off), and it is what makes a null <see cref="BoiloffRate"/>
    /// readable: no cryogenic tanks means nothing to measure, some tanks and no
    /// rate means the measurement failed.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? CryogenicTankCount { get; set; }
}
