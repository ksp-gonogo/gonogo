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
/// <para><b>M1 scoping note:</b> this record's <see cref="Meta"/> is stamped
/// <c>"vessel:&lt;guid&gt;"</c> like every other M1 channel in this task,
/// even though warp/pause is genuinely GLOBAL game state (not tied to any
/// vessel — <c>Gonogo.KSP.KspHost.BuildTime</c> reads it unconditionally).
/// This is a deliberate, documented M1 scoping simplification, not an
/// oversight: it keeps every channel this task ships on one uniform
/// provenance/epoching mechanism, at the cost of <c>time.warp</c> only
/// emitting while a vessel is active (e.g. it goes quiet at the Space
/// Center). Decoupling warp/pause from vessel presence — a genuine "system"
/// provenance concept — is a follow-up, not required for this task.</para>
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class WarpState
{
    public double WarpRate { get; set; }

    public int WarpRateIndex { get; set; }

    public WarpMode WarpMode { get; set; }

    public bool Paused { get; set; }

    public Meta Meta { get; set; } = new();
}
