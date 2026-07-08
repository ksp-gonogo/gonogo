#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Mirrors KSP's own <c>TimeWarp.Modes</c> enum (confirmed via decompile:
/// only <c>HIGH</c>/<c>LOW</c> exist on this KSP version — no third mode).
/// <see cref="Unknown"/> is the graceful fallback for a future/unrecognized
/// raw value.
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
public enum WarpMode
{
    High,
    Low,
    Unknown,
}

/// <summary>
/// The <c>time.warp</c> channel payload — kills N-3 (Telemachus's
/// <c>p.paused</c> conflates game-pause, no-power, off, antenna-not-found,
/// and scene state into one undocumented int, with a doc/impl mismatch: the
/// docs say <c>0..4</c> but <c>partPaused()</c> can return an undocumented
/// <c>5</c>). This record is instead orthogonal typed fields — no single int
/// can arrive with a meaning outside its own documented range.
///
/// <para><b>Current UT is deliberately NOT a field here</b> (or anywhere in
/// this contract): <c>meta.validAt</c> stamps every sample and the SDK's
/// view-clock is the consumer-facing "what time is it" surface — polling
/// <c>t.universalTime</c> over the wire (a tick-rate channel by definition)
/// is not reproduced.</para>
///
/// <para><b>Decoupled from vessel presence (M1 Task 3 fold-in fix):</b> this
/// record's <see cref="Meta"/> is stamped <c>Source = "game"</c>, NOT
/// <c>"vessel:&lt;guid&gt;"</c> — warp/pause is genuinely GLOBAL game state
/// (<c>Gonogo.KSP.KspHost.BuildTime</c> reads it unconditionally, with or
/// without an active vessel), so it emits at the Space Center / tracking
/// station too, not just in flight. An earlier draft gated this channel on
/// active-vessel presence as a scoping simplification (reusing the vessel
/// provenance/epoching mechanism uniformly); that gate silenced the channel
/// exactly where warp control matters most (out-of-flight scenes), so it was
/// removed — see <c>Sitrep.Host.VesselViewProvider.BuildWarp</c>'s doc
/// comment for the emission rule now in force (present whenever
/// <c>Values["time"]</c> itself is present, nothing else).</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class WarpState
{
    public double WarpRate { get; set; }

    public int WarpRateIndex { get; set; }

    public WarpMode WarpMode { get; set; }

    public bool Paused { get; set; }

    public PayloadMeta Meta { get; set; } = new();
}
