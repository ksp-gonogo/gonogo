#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// KSP's time-warp mode, mirroring its <c>TimeWarp.Modes</c> enum, which has
/// only <c>HIGH</c> and <c>LOW</c>. <see cref="Unknown"/> covers a raw value
/// KSP reports that neither matches.
/// </summary>
/// <category>Game</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum WarpMode
{
    /// <summary>On-rails time warp (KSP's <c>HIGH</c> mode).</summary>
    High,

    /// <summary>Physics warp (KSP's <c>LOW</c> mode).</summary>
    Low,

    /// <summary>KSP reported a mode this contract does not know.</summary>
    Unknown,
}

/// <summary>
/// The <c>time.warp</c> channel payload: the game's time-warp and pause state,
/// as separate typed fields.
///
/// <para>Current UT is not a field here (or anywhere in this contract):
/// <c>meta.validAt</c> stamps every sample, and the SDK's view clock is the
/// "what time is it" surface.</para>
///
/// <para>Warp and pause are GLOBAL game state, so <see cref="Meta"/> is
/// stamped <c>Source = "game"</c>, not <c>"vessel:&lt;guid&gt;"</c>, and the
/// channel emits at the Space Center and Tracking Station as well as in
/// flight, with or without an active vessel.</para>
/// <internal>
/// <c>Gonogo.KSP.KspHost.BuildTime</c> reads it unconditionally; see
/// <c>Sitrep.Host.VesselViewProvider.BuildWarp</c> for the emission rule
/// (present whenever <c>Values["time"]</c> itself is present, and the rate,
/// index and pause flag all read).
/// </internal>
/// </summary>
/// <category>Game</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("time.warp")]
public class WarpState
{
    /// <summary>The current time-warp multiplier (KSP's
    /// <c>TimeWarp.CurrentRate</c>): <c>1</c> is real time, <c>1000</c> is
    /// game time passing a thousand times faster.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double WarpRate { get; set; }

    /// <summary>The current rung of the warp rate table (KSP's
    /// <c>TimeWarp.CurrentRateIndex</c>), <c>0</c> at real time. Under
    /// <see cref="Sitrep.Contract.WarpMode.High"/> it indexes <see cref="WarpRates"/>.</summary>
    [SitrepUnit(Units.Id)]
    public int WarpRateIndex { get; set; }

    /// <summary>Which warp mode is in force, on-rails or physics (KSP's
    /// <c>TimeWarp.WarpMode</c>).</summary>
    [SitrepUnit(Units.Enumeration)]
    public WarpMode WarpMode { get; set; }

    /// <summary>Whether the game is paused (KSP's
    /// <c>FlightDriver.Pause</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool Paused { get; set; }

    /// <summary>
    /// What every HIGH-warp rung of THIS install actually runs at, indexed by
    /// <see cref="WarpRateIndex"/>, so <c>warpRates[i]</c> is the multiplier
    /// <c>time.setWarpIndex</c> with <c>index = i</c> produces. Null when the
    /// game has no warp controller to read it off (no scene that can warp).
    ///
    /// <para>The table is CONFIG, not a constant: Kopernicus and
    /// RealSolarSystem both republish it, so a rung stock runs at 100x may run
    /// at 10000x on another install. Read the rate here rather than assuming
    /// stock's table.</para>
    /// <internal>
    /// <c>TimeWarp.fetch.warpRates</c>, HIGH warp only (the same table
    /// <c>Gonogo.KSP.KspVesselActuator</c> bounds a <c>time.setWarpIndex</c>
    /// against), widened float -&gt; double on the way out. Physics warp has
    /// its own table and no client asks for one by index.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Dimensionless)]
    public double[]? WarpRates { get; set; }

    /// <summary>
    /// The shortest real time the mod leaves between two periodic keyframes on
    /// one channel, in seconds.
    ///
    /// <para>Keyframe cadences are declared in UT, and under warp UT can pass a
    /// cadence on every tick, so the mod also waits at least this long in real
    /// time. The gap a client sees between two keyframes of a quiet channel is
    /// therefore at least <c>keyframeFloorSec × warpRate</c> UT. A client that
    /// infers staleness from keyframe cadence has to allow for that, or every
    /// quiet channel reads as held too long just after a warp step-up.</para>
    ///
    /// <para>On this topic because its only use is that product, and both
    /// halves then arrive in the same sample.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double KeyframeFloorSec { get; set; }

    /// <summary>
    /// The UT that actually passes between two samples at the current warp
    /// rate, in seconds, or <c>null</c> where the host did not report its
    /// physics step.
    ///
    /// <para><see cref="SampleIntervalUt"/> up to 10x. Above that the mod
    /// samples at most ten times a real second, so this is a tenth of a second
    /// of game time at the current rate (10,000 at 100,000x), or one physics
    /// tick where a tick advances the game further than that.
    /// Nothing between two consecutive samples was observed, so a line drawn
    /// between two samples that differ asserts a path across this span that
    /// only a model of the value can stand behind. Two samples further apart
    /// than this are a channel that did not change in between.</para>
    ///
    /// <para>On this topic beside <see cref="KeyframeFloorSec"/> because it is
    /// the other thing warp does to cadence, and it changes only when the rate
    /// does. A client judging a gap reads the quantum in force when the later
    /// sample was taken.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? ObservationQuantumUt { get; set; }

    /// <summary>
    /// The UT between two samples while warp is not thinning them, in seconds:
    /// the finest spacing the record ever has, and <see cref="ObservationQuantumUt"/>
    /// at 1x. Constant for the life of the mod.
    ///
    /// <para>The chord between two samples this far apart is the resolution
    /// every channel is sampled at, and a chart can draw it. Where the
    /// quantum is wider, the span beyond this is one the sampling skipped
    /// because of warp, and a line across it that no model of the value
    /// carries asserts a path nothing observed.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double SampleIntervalUt { get; set; }

    /// <summary>The payload's provenance (always <c>"game"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
