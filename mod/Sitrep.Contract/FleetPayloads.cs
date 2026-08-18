#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Display-only per-vessel link facts on <c>fleet.&lt;guid&gt;.delay</c>: the
/// one-way light-time to that vessel and whether it is currently reachable. The
/// mod already computes both (<c>FleetCommsReader.ReadVessel</c>) to set the
/// per-vessel channel delay and per-subject freeze; this surfaces the same
/// numbers for the FleetRoster UI. Not a control input.
///
/// <para>Rides the Delayed <c>fleet.</c> namespace like <c>fleet.&lt;guid&gt;.orbit</c>,
/// so the value itself arrives light-time-late: honest (KSC's knowledge of a
/// distant vessel's link geometry IS that old) and consistent, and the value
/// varies slowly enough that the meta-lag is immaterial.</para>
///
/// <para>R7 typed-absence: <see cref="OneWaySeconds"/> is nullable, a vessel with
/// no comms path carries <c>null</c>, never a sentinel <c>0</c> that would read
/// as a zero-delay direct link.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class FleetVesselLink
{
    /// <summary>One-way light-time to this vessel, seconds. Null when there is no path (unreachable / torn-down state).</summary>
    [SitrepUnit(Units.Seconds)]
    public double? OneWaySeconds { get; set; }

    /// <summary>Whether this vessel is currently reachable (<c>v.connection.IsConnected</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }
}

/// <summary>
/// The CORE per-vessel contact facts on <c>fleet.&lt;guid&gt;.contact</c>:
/// whether the vessel is currently in contact, and when it was last heard
/// from. With CommNet disabled this is trivially <c>Connected: true</c>
/// always; with it enabled the value is the same live network-presence read
/// <c>fleet.&lt;guid&gt;.delay</c> already carries. No modelling, no
/// deadlines, no opinion about whether the vessel is "lost": that reckoning
/// is a comms-derived judgement, not a fact stock KSP hands you, and lives
/// on the separate <see cref="FleetVesselSilence"/> wire type instead (see
/// its own doc comment for why the two are split).
///
/// <para>Rides the same Delayed <c>fleet.</c> namespace as
/// <see cref="FleetVesselLink"/>/<c>fleet.&lt;guid&gt;.orbit</c>, so the
/// value itself arrives light-time-late, honest for the same reason those
/// do. Freeze-exempt (<c>ChannelEngine.ContactMetaSuffix</c>): the disconnect
/// edge has to escape the reveal-gate freeze or "NO SIGNAL" could never
/// fire, the same reasoning as <c>comms.link</c>.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class FleetVesselContact
{
    /// <summary>Whether contact was observed on the most recent capture tick.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }

    /// <summary>UT of the last sample that observed contact. Null before the first-ever contact.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LastContactUt { get; set; }
}

/// <summary>
/// The COMMS-OWNED officially-lost reckoning on <c>silence.&lt;guid&gt;.state</c>:
/// how long a vessel's silence has run and when it becomes eligible to be
/// declared lost. This is a MODEL's opinion, not a fact: it exists only
/// because something (the pure <c>Sitrep.Host.Comms.SilenceTracker</c>) is
/// watching occultation geometry and deciding a craft is overdue, which is
/// why it is registered from the comms uplink rather than riding the
/// always-on core <see cref="FleetVesselContact"/> (see
/// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>).
///
/// <para>A disjoint dynamic namespace (<c>ChannelEngine.SilenceEventPrefix</c>)
/// that maps back onto the same per-vessel <c>fleet.&lt;guid&gt;</c> Courier
/// node <see cref="FleetVesselContact"/> uses, so the reveal/freeze/delay
/// treatment for a vessel's telemetry and its silence reckoning stay
/// identical, freeze-exempt for the same reason
/// <see cref="FleetVesselContact"/> is.</para>
///
/// <para>Deliberately narrow for this pass: <c>declaredLostUt</c> and the
/// monotonic <c>lostSeq</c> a future currency consumer needs for idempotent
/// arming stay off the wire until that consumer exists, see the design
/// doc's scope note. Nothing here is a control input.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class FleetVesselSilence
{
    /// <summary>One of <c>Nominal</c> / <c>Silent</c> / <c>Lost</c> (<c>Sitrep.Host.Comms.SilenceState</c>).</summary>
    [SitrepUnit(Units.Enumeration)]
    public string State { get; set; } = "Nominal";

    /// <summary>UT the current silence run began. Null while Nominal.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? SilenceSinceUt { get; set; }

    /// <summary>UT at which this silence run becomes eligible to be declared Lost. Null while Nominal, or for a destroyed vessel.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DeadlineUt { get; set; }

    /// <summary>
    /// One of <c>orbital-period</c> / <c>policy-floor</c> / <c>policy-ceiling</c> /
    /// <c>no-orbit</c> / <c>destroyed</c> / <c>predicted-reacquisition</c> /
    /// <c>no-occultation</c> / <c>no-emergence-in-window</c> / <c>warp-limited</c> /
    /// <c>grace-exceeds-ceiling</c>
    /// (<c>Sitrep.Host.Comms.SilenceDeadlineBasis</c>). Null while Nominal.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? DeadlineBasis { get; set; }

    /// <summary>
    /// UT the radio path is predicted to re-open, when a visibility sweep
    /// found one. This is what "should be back in ~16 min" is rendered from,
    /// and what makes "it did not show up" expressible at all.
    ///
    /// <para>Null whenever no honest prediction exists, no geometry, no
    /// occultation to emerge from, or a warp too coarse to resolve one, and
    /// <c>deadlineBasis</c> says which. A null is a prediction WITHHELD, never
    /// an emergence of "now": a client must render the absence as "no
    /// prediction", not as an overdue vessel.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictedReacquisitionUt { get; set; }
}
