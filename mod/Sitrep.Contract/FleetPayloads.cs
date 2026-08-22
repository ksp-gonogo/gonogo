using System.Collections.Generic;
#if SITREP_CODEGEN
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
#if SITREP_CODEGEN
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
#if SITREP_CODEGEN
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
#if SITREP_CODEGEN
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

    /// <summary>
    /// The error budget the deadline was armed with, seconds: how long past the
    /// predicted return this craft may stay quiet before its silence is
    /// something other than a late reappearance.
    ///
    /// <para>It is the only thing on the wire that says how much confidence to
    /// place in <see cref="PredictedReacquisitionUt"/> beside it. Without it, "back in 15 min" and
    /// "back in 15 min, and we would not call it late for another 5" render
    /// identically.</para>
    ///
    /// <para>ONE-SIDED, and not a symmetric uncertainty: it is an allowance
    /// after the predicted moment, so render "allowing 5 min of slack" and
    /// never "+/- 5 min". Null wherever the prediction is null, since a budget
    /// quoted next to a withheld prediction is an error bar around
    /// nothing.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? PredictionGraceSeconds { get; set; }
}

/// <summary>
/// One fleet vessel's resource amounts on <c>fleet.&lt;guid&gt;.resources</c>:
/// the same keyed map <see cref="VesselResources"/> carries for the active
/// craft, with the same three-way absence semantics (see that type's doc
/// comment), for a craft you are not flying.
///
/// <para><b>Amounts only. No rate, and deliberately no exhaustion time.</b> A
/// consumption rate for an UNLOADED vessel is background simulation, which is a
/// life-support Uplink's domain and not core's: stock does not run one, and a
/// core-published "life support runs out at UT X" would be core pretending to a
/// model it does not have. Core reports what is in the tanks; whatever models
/// the draw contributes the exhaustion time on top. That ownership split is
/// why an exhaustion time has to arrive through a contribution slot rather than
/// as a field here. No slot hosts it today: the one this was designed against
/// went with the retired VesselTracker widget, and `fleet-roster.updates` is
/// the per-vessel seam of the same shape still standing.</para>
///
/// <para>Rides the Delayed per-vessel <c>fleet.</c> namespace like
/// <c>fleet.&lt;guid&gt;.orbit</c>, so the reading arrives light-time-late,
/// which is honest: how much fuel a distant craft has is exactly as old as the
/// last signal from it. Unlike its siblings it is NOT freeze-exempt, and should
/// not be: a tank level from a craft we cannot currently hear is last-known,
/// and freezing it at last-known is the correct depiction.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FleetVesselResources
{
    public Dictionary<string, ResourceAmount> Resources { get; set; } = new Dictionary<string, ResourceAmount>();
}

/// <summary>
/// One vessel's reckoning inside the fleet-wide <see cref="FleetSilence"/>
/// roster: the same fields <see cref="FleetVesselSilence"/> carries, plus the
/// vessel id that the per-vessel topic gets from its own topic string.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FleetSilenceEntry
{
    /// <summary>Stable subject id (KSP vessel GUID), the same id the <c>fleet.</c> and <c>silence.</c> namespaces key on.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>One of <c>Nominal</c> / <c>Silent</c> / <c>Lost</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string State { get; set; } = "Nominal";

    /// <summary>UT the current silence run began. Null while Nominal.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? SilenceSinceUt { get; set; }

    /// <summary>UT at which this silence run becomes eligible to be declared Lost. Null while Nominal, or for a destroyed vessel.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DeadlineUt { get; set; }

    /// <summary>One of <c>Sitrep.Host.Comms.SilenceDeadlineBasis</c>. Null while Nominal.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string? DeadlineBasis { get; set; }

    /// <summary>UT the radio path is predicted to re-open. Null is a prediction WITHHELD, never an emergence of "now".</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictedReacquisitionUt { get; set; }

    /// <summary>
    /// The error budget the deadline was armed with, seconds: how long past the
    /// predicted return this craft may stay quiet before its silence is
    /// something other than a late reappearance.
    ///
    /// <para>It is the only thing on the wire that says how much confidence to
    /// place in <see cref="PredictedReacquisitionUt"/> beside it. Without it, "back in 15 min" and
    /// "back in 15 min, and we would not call it late for another 5" render
    /// identically.</para>
    ///
    /// <para>ONE-SIDED, and not a symmetric uncertainty: it is an allowance
    /// after the predicted moment, so render "allowing 5 min of slack" and
    /// never "+/- 5 min". Null wherever the prediction is null, since a budget
    /// quoted next to a withheld prediction is an error bar around
    /// nothing.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? PredictionGraceSeconds { get; set; }
}

/// <summary>
/// The fleet-wide silence roster on <c>fleet.silence</c>: every vessel the
/// tracker holds a reckoning for, in one payload.
///
/// <para><b>Why this exists when <c>silence.&lt;guid&gt;.state</c> already
/// does.</b> A per-vessel topic can only be read by something that already
/// knows which vessel to ask for, which makes it unusable as the input to
/// anything that has to work the fleet out for itself. Concretely: a
/// contribution declares its dependencies STATICALLY at module load, so no
/// contribution can name a per-guid topic, and the client-side bridge that
/// reaches those topics only holds vessels some component is ALREADY
/// subscribed to. A fan-out over that bridge sees exactly the vessels a widget
/// had already rendered, which is circular. One static topic carrying every
/// entry breaks the circle: a Processor declares it once, derives once per
/// frame, and a contribution fans out over entries that genuinely exist.</para>
///
/// <para><b>Delayed on the MAIN node, and that is a real difference.</b>
/// <see cref="FleetVesselSilence"/> rides the per-vessel node, so each
/// vessel's reckoning arrives on that vessel's own light-time and is
/// freeze-exempt. A single aggregate cannot do that: one payload has one node
/// and one delay. So this rides the main node's delay, exactly as
/// <see cref="SystemVessels"/> does while carrying per-vessel
/// <c>CommsConnected</c> alongside the per-subject-delayed
/// <see cref="FleetVesselContact"/>. The per-vessel topic stays authoritative
/// for one vessel on that vessel's own clock; this is the fleet-wide index.
/// A consumer that needs the former must not substitute the latter.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("fleet.silence")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FleetSilence
{
    public IReadOnlyList<FleetSilenceEntry> Vessels { get; set; } = new List<FleetSilenceEntry>();
}
