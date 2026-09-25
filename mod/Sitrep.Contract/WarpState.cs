#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Mirrors KSP's own <c>TimeWarp.Modes</c> enum (confirmed via decompile:
/// only <c>HIGH</c>/<c>LOW</c> exist on this KSP version, no third mode).
/// <see cref="Unknown"/> is the graceful fallback for a future/unrecognized
/// raw value.
/// </summary>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum WarpMode
{
    High,
    Low,
    Unknown,
}

/// <summary>
/// The <c>time.warp</c> channel payload: kills N-3 (the legacy
/// <c>p.paused</c> conflates game-pause, no-power, off, antenna-not-found,
/// and scene state into one undocumented int, with a doc/impl mismatch: the
/// docs say <c>0..4</c> but <c>partPaused()</c> can return an undocumented
/// <c>5</c>). This record is instead orthogonal typed fields, no single int
/// can arrive with a meaning outside its own documented range.
///
/// <para><b>Current UT is deliberately NOT a field here</b> (or anywhere in
/// this contract): <c>meta.validAt</c> stamps every sample and the SDK's
/// view-clock is the consumer-facing "what time is it" surface, polling
/// <c>t.universalTime</c> over the wire (a tick-rate channel by definition)
/// is not reproduced.</para>
///
/// <para><b>Decoupled from vessel presence (M1 Task 3 fold-in fix):</b> this
/// record's <see cref="Meta"/> is stamped <c>Source = "game"</c>, NOT
/// <c>"vessel:&lt;guid&gt;"</c>: warp/pause is genuinely GLOBAL game state
/// (<c>Gonogo.KSP.KspHost.BuildTime</c> reads it unconditionally, with or
/// without an active vessel), so it emits at the Space Center / tracking
/// station too, not just in flight. An earlier draft gated this channel on
/// active-vessel presence as a scoping simplification (reusing the vessel
/// provenance/epoching mechanism uniformly); that gate silenced the channel
/// exactly where warp control matters most (out-of-flight scenes), so it was
/// removed: see <c>Sitrep.Host.VesselViewProvider.BuildWarp</c>'s doc
/// comment for the emission rule now in force (present whenever
/// <c>Values["time"]</c> itself is present, nothing else).</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("time.warp")]
public class WarpState
{
    [SitrepUnit(Units.Dimensionless)]
    public double WarpRate { get; set; }

    [SitrepUnit(Units.Id)]
    public int WarpRateIndex { get; set; }

    [SitrepUnit(Units.Enumeration)]
    public WarpMode WarpMode { get; set; }

    [SitrepUnit(Units.Flag)]
    public bool Paused { get; set; }

    /// <summary>
    /// What every HIGH-warp rung of THIS install actually runs at, indexed by
    /// <see cref="WarpRateIndex"/>, so <c>warpRates[i]</c> is the multiplier
    /// <c>time.setWarpIndex</c> with <c>index = i</c> produces. Null when the
    /// game has no warp controller to read it off (no scene that can warp).
    ///
    /// <para>It ships because the table is CONFIG, not a constant: Kopernicus
    /// and RealSolarSystem both republish it, and a client that assumed
    /// stock's asked for the rung it believed to be 100x on an install that
    /// runs it at 10000x. Without it a client can only learn a rung's rate by
    /// warping at it, which is exactly the experiment that costs the game
    /// clock the overshoot it was trying to avoid.</para>
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
    /// quiet channel reads stale just after a warp step-up.</para>
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
    /// every channel is sampled at, and a chart has always drawn it. Where the
    /// quantum is wider, the span beyond this is one the sampling skipped
    /// because of warp, and a line across it that no model of the value
    /// carries asserts a path nothing observed.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double SampleIntervalUt { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
