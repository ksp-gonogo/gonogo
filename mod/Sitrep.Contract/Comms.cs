#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

// ====================================================================
// The comms.* wire contract (U2 — comms trio).
//
// Two axes govern every channel here (comms-uplink-design.md §1): a
// PROVIDER axis (the elected backend — CommNet vanilla, or RealAntennas
// when present — sources the shared channels; RealAntennas alone sources
// its private link-budget channels) and a PRESENCE axis (always-present
// vs provider-dependent). All comms.* channels are TRUE-NOW: they describe
// the link AS KSC SEES IT, computed ground-side. comms.delay in particular
// is true-now sim-meta — the value that DRIVES the delay of every other
// channel, so it is itself never delay-gated (delaying it would be
// circular — §1 "delay classification").
//
// R7 discipline: every payload carries PayloadMeta; absence is a nullable
// (T?), never a NaN/0/-1 sentinel.
// ====================================================================

/// <summary>
/// Degree of vessel control the link currently affords — the
/// <c>controlSource</c> axis of <see cref="CommsConnectivity"/>. Mirrors
/// stock <c>CommNet.VesselControlState</c>'s partial/full distinction
/// without leaking a KSP enum onto the wire.
/// </summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum CommsControlSource
{
    None,
    Partial,
    Full,
}

/// <summary>
/// The <c>comms.connectivity</c> payload — always-present, sourced from the
/// elected backend (comms-uplink-design.md §1). Ground-side truth about
/// whether the active vessel has a control link home right now.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.connectivity")]
public class CommsConnectivity
{
    public bool Connected { get; set; }
    public CommsControlSource ControlSource { get; set; }
    public bool HasLocalControl { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.signalStrength</c> payload — always-present, elected
/// backend. 0..1. CommNet gives a coarse range-fraction; RealAntennas gives
/// a link-budget-derived value (comms-uplink-design.md §1).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.signalStrength")]
public class CommsSignalStrength
{
    public double Value { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>Control-state kind for <see cref="CommsControlState"/>.</summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum CommsControlStateKind
{
    None,
    PartialManoeuvre,
    Full,
}

/// <summary>
/// The <c>comms.controlState</c> payload — always-present, elected backend.
/// <see cref="Reason"/> is a nullable annotation (absent = no annotation),
/// never an empty-string sentinel.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.controlState")]
public class CommsControlState
{
    public CommsControlStateKind State { get; set; }
    public string? Reason { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>Kind of a node participating in a <see cref="CommsHop"/>.</summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum CommsHopKind
{
    Home,
    Relay,
    Vessel,
}

/// <summary>
/// One ordered hop toward KSC in the control path. <see cref="DistanceMeters"/>
/// is the geometry SignalDelay consumes for light-time; it is nullable —
/// absent when the backend cannot supply per-hop geometry (typed absence,
/// never 0). <see cref="BandRateBitsPerSec"/> is the RealAntennas-only
/// per-hop rate annotation (§1 "path hops gain RA band/rate annotations only
/// under RA") — absent under bare CommNet.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CommsHop
{
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    public CommsHopKind Kind { get; set; }
    public double? DistanceMeters { get; set; }
    public double? BandRateBitsPerSec { get; set; }
}

/// <summary>
/// The <c>comms.path</c> payload — always-present, elected backend. Ordered
/// hops from the active vessel to KSC. Empty <see cref="Hops"/> = no path
/// home (a real, control-loss state, not absence-of-data).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.path")]
public class CommsPath
{
    public IReadOnlyList<CommsHop> Hops { get; set; } = new List<CommsHop>();
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>One node in the <see cref="CommsNetwork"/> relay graph.</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CommsNetworkNode
{
    public string Id { get; set; } = "";
    public CommsHopKind Kind { get; set; }
}

/// <summary>One edge in the <see cref="CommsNetwork"/> relay graph.</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CommsNetworkEdge
{
    public string A { get; set; } = "";
    public string B { get; set; } = "";
    public bool Active { get; set; }
}

/// <summary>
/// The <c>comms.network</c> payload — always-emitted, but its richness
/// tracks the elected backend (comms-uplink-design.md §1: "backend-dependent
/// detail"). Under bare CommNet this may be a single home-edge; under
/// RealAntennas it enumerates the relay graph.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.network")]
public class CommsNetwork
{
    public IReadOnlyList<CommsNetworkNode> Nodes { get; set; } = new List<CommsNetworkNode>();
    public IReadOnlyList<CommsNetworkEdge> Edges { get; set; } = new List<CommsNetworkEdge>();
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>Where a <see cref="CommsDelay"/> value came from.</summary>
#if NETSTANDARD2_0
[TsEnum]
#endif
[SitrepContract]
public enum CommsDelaySource
{
    None,
    SignalDelay,
}

/// <summary>
/// The <c>comms.delay</c> payload — the CORE SignalDelay capability's output
/// (comms-uplink-design.md §3), gated by the <c>comms.signalDelay.enabled</c>
/// config flag. <see cref="OneWaySeconds"/> distinguishes two DIFFERENT
/// "no delay" cases by value (R7: typed absence, never a single overloaded
/// sentinel):
/// <list type="bullet">
/// <item><description><b>null</b> — no measurable <see cref="CommsPath"/>
/// (no path home, or incomplete hop geometry). There is nothing to measure,
/// so nothing is reported. <see cref="Source"/> is
/// <see cref="CommsDelaySource.None"/>.</description></item>
/// <item><description><b>0</b> — the delay feature is disabled
/// (<c>comms.signalDelay.enabled = false</c>) but the vessel IS connected. A
/// genuine "zero delay applied", not an absence. <see cref="Source"/> is
/// also <see cref="CommsDelaySource.None"/> here — the two cases share the
/// same <c>Source</c> and are told apart only by whether the value is
/// null.</description></item>
/// <item><description>a real number — <see cref="Source"/> is
/// <see cref="CommsDelaySource.SignalDelay"/>; gonogo's own light-time math
/// over the elected backend's hop geometry.</description></item>
/// </list>
/// TRUE-NOW sim-meta: this value drives the release of every other delayed
/// channel and is therefore never itself delay-gated.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.delay")]
public class CommsDelay
{
    public double? OneWaySeconds { get; set; }
    public CommsDelaySource Source { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.link</c> connectivity MetaTopic — the ONE client-facing
/// answer to "is there a control link home right now?", carried as a
/// <b>Delayed, freeze-EXEMPT</b> channel (see
/// <c>ChannelEngine.ConnectivityMetaTopic</c>). It is the delayed successor to
/// the de-publicised TrueNow <see cref="CommsConnectivity"/> observation
/// channel: clients (the app's SignalLossIndicator/CameraFeed, the kOS
/// terminal's line-mode gate) read <c>comms.link.connected</c> instead of any
/// raw <c>comms.*</c> observation.
///
/// <para><b>Why its own topic, freeze-exempt:</b> the link state is what
/// REPORTS the freeze, so — exactly parallel to <c>comms.delay</c> being exempt
/// from its own delay — it must be exempt from the freeze it drives. It reveals
/// the disconnect edge at <c>T+delay</c> (you learn of the outage one light-time
/// after it happens) and keeps reporting <c>connected:false</c> through the
/// blackout, so the client's "NO SIGNAL" flips at the correct delayed instant.
/// The <see cref="VesselComms"/> observation struct (signalStrength/controlState)
/// stays Delayed AND freeze-gated — it freezes at last-known through the
/// outage.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.link")]
public class CommsLink
{
    public bool Connected { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.linkQuality</c> payload — RealAntennas-ONLY (absent without
/// RA). Link margin normalised to 0..1 (comms-uplink-design.md §2.2/§4.3).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.linkQuality")]
public class CommsLinkQuality
{
    public double Value { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.dataRate</c> payload — RealAntennas-ONLY. Bidirectional link
/// data rate in bits/sec, read live per-hop off the RA CommNet graph
/// (comms-uplink-design.md §4.3: "reachable cleanly").
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.dataRate")]
public class CommsDataRate
{
    public double UpBitsPerSec { get; set; }
    public double DownBitsPerSec { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The <c>comms.linkMargin</c> payload — RealAntennas-ONLY. Re-derived by the
/// RealAntennas uplink from RA's public static link-budget math, NOT read off
/// a live field (comms-uplink-design.md §4.3: margin is computed transiently
/// inside RA's internal Precompute job and not stored anywhere public).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("comms.linkMargin")]
public class CommsLinkMargin
{
    public double DecibelMargin { get; set; }
    public bool ClosesLink { get; set; }
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// The pure, KSP-free object the exclusive <c>"comms"</c> capability resolves
/// to (comms-uplink-design.md §2.2). Exactly the readouts BOTH backends can
/// honestly supply — the minimal shape the parallel CommNet+RA build forces
/// (§6). RealAntennas-only richness (link margin, data rate) is deliberately
/// OUT of this interface and lives on RA's private channels instead.
///
/// <para>Each accessor returns a wire payload the shared core comms
/// registration publishes to its channel after resolving the elected backend
/// via <c>host.Kernel.Query&lt;ICommsBackend&gt;("comms")</c>. Implementations
/// read live KSP/mod state and MUST be called only where such reads are safe
/// (the capture-on-main seam) — the interface itself is pure.</para>
/// </summary>
public interface ICommsBackend
{
    /// <summary>A short id for the elected backend, e.g. <c>"commnet"</c> or <c>"realantennas"</c>.</summary>
    string BackendId { get; }

    CommsConnectivity Connectivity();
    CommsSignalStrength SignalStrength();
    CommsControlState ControlState();

    /// <summary>Ordered hops to KSC — the geometry SignalDelay reads for light-time (§3).</summary>
    CommsPath Path();

    CommsNetwork Network();
}
