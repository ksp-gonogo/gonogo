using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Per-vessel link facts on <c>fleet.&lt;guid&gt;.delay</c>: the one-way
/// light-time to that vessel and whether it is currently reachable. The same
/// numbers the mod uses to delay that vessel's channels, published for display.
/// Not a control input.
///
/// <para>Delayed like <c>fleet.&lt;guid&gt;.orbit</c>, so the value itself
/// arrives one light-time late, which is how old the space centre's knowledge
/// of the link is.</para>
///
/// <para>A vessel with no comms path carries a null
/// <see cref="OneWaySeconds"/>, never a <c>0</c> that would read as a
/// zero-delay link.</para>
/// <internal>Computed by <c>FleetCommsReader.ReadVessel</c>, which also sets
/// the per-vessel channel delay and freeze.</internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FleetVesselLink
{
    /// <summary>One-way light-time to this vessel, in seconds. Null when there is
    /// no comms path to it.</summary>
    [SitrepUnit(Units.Seconds)]
    public double? OneWaySeconds { get; set; }

    /// <summary>Whether this vessel is currently reachable
    /// (<c>v.connection.IsConnected</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }
}

/// <summary>
/// The core per-vessel contact facts on <c>fleet.&lt;guid&gt;.contact</c>:
/// whether the vessel is currently in contact, and when it was last heard
/// from. With CommNet disabled <see cref="Connected"/> is always true; with it
/// enabled it is the same network-presence read <c>fleet.&lt;guid&gt;.delay</c>
/// carries. No modelling and no opinion about whether the vessel is lost: that
/// judgement is on <see cref="FleetVesselSilence"/>.
///
/// <para>Delayed like <see cref="FleetVesselLink"/>, so the value arrives one
/// light-time late. Unlike most delayed telemetry it keeps updating while the
/// vessel is out of contact, so the loss of contact itself reaches the
/// client.</para>
/// <internal>Freeze-exempt through <c>ChannelEngine.ContactMetaSuffix</c>, the
/// same reasoning as <c>comms.link</c>.</internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FleetVesselContact
{
    /// <summary>Whether contact was observed on the most recent sample.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Connected { get; set; }

    /// <summary>Universal time of the last sample that observed contact. Null
    /// before the first contact.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? LastContactUt { get; set; }
}

/// <summary>
/// The lost-vessel reckoning on <c>silence.&lt;guid&gt;.state</c>: how long a
/// vessel's silence has run and when it becomes eligible to be declared lost.
/// This is a model's judgement from occultation geometry, not a fact stock KSP
/// provides, so it comes from the comms Uplink rather than the always-present
/// <see cref="FleetVesselContact"/>.
///
/// <para>Delayed on the same per-vessel clock as
/// <see cref="FleetVesselContact"/>, and like it keeps updating while the
/// vessel is out of contact.</para>
///
/// <para>Nothing here is a control input.</para>
/// <internal>Produced by <c>Sitrep.Host.Comms.SilenceTracker</c>. The
/// <c>ChannelEngine.SilenceEventPrefix</c> namespace maps back onto the same
/// per-vessel <c>fleet.&lt;guid&gt;</c> Courier node, so reveal, freeze and
/// delay treatment stay identical.</internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FleetVesselSilence
{
    /// <summary>One of <c>"Nominal"</c> (in contact), <c>"Silent"</c> (out of
    /// contact, not yet eligible to be declared lost) or <c>"Lost"</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string State { get; set; } = "Nominal";

    /// <summary>Universal time the current silence run began. Null while Nominal.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? SilenceSinceUt { get; set; }

    /// <summary>Universal time at which this silence run becomes eligible to be
    /// declared Lost. Null while Nominal, or for a destroyed vessel.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DeadlineUt { get; set; }

    /// <summary>
    /// What <see cref="DeadlineUt"/> was based on.
    /// One of <c>orbital-period</c> / <c>policy-floor</c> /
    /// <c>policy-ceiling</c> / <c>no-orbit</c> / <c>destroyed</c> /
    /// <c>predicted-reacquisition</c> / <c>no-occultation</c> /
    /// <c>no-emergence-in-window</c> / <c>warp-limited</c> /
    /// <c>grace-exceeds-ceiling</c> / <c>horizon-limited</c>. Null while
    /// Nominal.
    /// <internal>Values are <c>Sitrep.Host.Comms.SilenceDeadlineBasis</c>.</internal>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? DeadlineBasis { get; set; }

    /// <summary>
    /// When the radio path is predicted to re-open, if a visibility sweep
    /// found one, in universal time. This is what "should be back in ~16 min"
    /// is rendered from.
    ///
    /// <para>Null whenever no sound prediction exists (no geometry, no
    /// occultation to emerge from, or a warp too coarse to resolve one), and
    /// <c>deadlineBasis</c> says which. A null is a prediction withheld, never
    /// an emergence of "now": render it as "no prediction", not as an overdue
    /// vessel.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictedReacquisitionUt { get; set; }

    /// <summary>
    /// The error budget the deadline was set with, in seconds: how long past the
    /// predicted return this craft may stay quiet before its silence is
    /// something other than a late reappearance.
    ///
    /// <para>The only value on the wire that says how much confidence to place
    /// in <see cref="PredictedReacquisitionUt"/> beside it.</para>
    ///
    /// <para>One-sided, not a symmetric uncertainty: it is an allowance after
    /// the predicted moment, so render "allowing 5 min of slack", never
    /// "+/- 5 min". Null wherever the prediction is null.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? PredictionGraceSeconds { get; set; }
}

/// <summary>
/// One fleet vessel's resource amounts on <c>fleet.&lt;guid&gt;.resources</c>:
/// the same keyed map <see cref="VesselResources"/> carries for the active
/// craft, for a craft you are not flying. A resource the craft has no capacity
/// for is absent from the map; one it carries but has emptied is present with
/// a current amount of <c>0</c>.
///
/// <para>Amounts only: no rate and no exhaustion time. Stock KSP does not
/// simulate consumption on an unloaded vessel, so a rate or exhaustion time
/// belongs to whichever Uplink models the draw, contributed on top of this.</para>
///
/// <para>Delayed like <c>fleet.&lt;guid&gt;.orbit</c>, so the reading arrives
/// one light-time late. While the craft is out of contact the reading is held
/// at its last-known value.</para>
/// <internal>Loaded craft read their live parts, unloaded ones their
/// <c>ProtoPartSnapshot</c>s; a failed read omits the whole payload rather
/// than publishing a partial tank list. Not freeze-exempt, unlike its
/// siblings.</internal>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FleetVesselResources
{
    /// <summary>
    /// The vessel's resources keyed by KSP resource name (for example
    /// <c>"LiquidFuel"</c>), each summed across every part that holds it. Never
    /// null; empty for a craft that carries no resources.
    /// </summary>
    public Dictionary<string, ResourceAmount> Resources { get; set; } = new Dictionary<string, ResourceAmount>();
}

/// <summary>
/// One vessel's reckoning inside the fleet-wide <see cref="FleetSilence"/>
/// roster: the same fields <see cref="FleetVesselSilence"/> carries, plus the
/// vessel id that the per-vessel topic gets from its own topic string.
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FleetSilenceEntry
{
    /// <summary>The KSP vessel GUID, the same id the <c>fleet.</c> and
    /// <c>silence.</c> topics key on.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = "";

    /// <summary>One of <c>"Nominal"</c> (in contact), <c>"Silent"</c> (out of
    /// contact, not yet eligible to be declared lost) or <c>"Lost"</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string State { get; set; } = "Nominal";

    /// <summary>UT the current silence run began. Null while Nominal.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? SilenceSinceUt { get; set; }

    /// <summary>UT at which this silence run becomes eligible to be declared
    /// Lost. Null while Nominal, or for a destroyed vessel.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? DeadlineUt { get; set; }

    /// <summary>
    /// What <see cref="DeadlineUt"/> was based on.
    /// One of <c>orbital-period</c> / <c>policy-floor</c> /
    /// <c>policy-ceiling</c> / <c>no-orbit</c> / <c>destroyed</c> /
    /// <c>predicted-reacquisition</c> / <c>no-occultation</c> /
    /// <c>no-emergence-in-window</c> / <c>warp-limited</c> /
    /// <c>grace-exceeds-ceiling</c> / <c>horizon-limited</c>. Null while
    /// Nominal.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string? DeadlineBasis { get; set; }

    /// <summary>When the radio path is predicted to re-open, in universal time.
    /// Null is a prediction withheld, never an emergence of "now".</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictedReacquisitionUt { get; set; }

    /// <summary>
    /// The error budget the deadline was set with, in seconds: how long past the
    /// predicted return this craft may stay quiet before its silence is
    /// something other than a late reappearance.
    ///
    /// <para>The only value on the wire that says how much confidence to place
    /// in <see cref="PredictedReacquisitionUt"/> beside it.</para>
    ///
    /// <para>One-sided, not a symmetric uncertainty: it is an allowance after
    /// the predicted moment, so render "allowing 5 min of slack", never
    /// "+/- 5 min". Null wherever the prediction is null.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? PredictionGraceSeconds { get; set; }
}

/// <summary>
/// The fleet-wide silence roster on <c>fleet.silence</c>: every vessel the
/// tracker holds a reckoning for, in one payload.
///
/// <para>A per-vessel topic can only be read by something that already knows
/// which vessel to ask for. This one static topic lists every vessel, so a
/// consumer that has to work the fleet out for itself (a contribution, which
/// declares its topics statically, or a Processor) can fan out over entries
/// that exist.</para>
///
/// <para>Delayed as one payload on the stream's main delay, not on each
/// vessel's own light-time, as with <see cref="SystemVessels"/>.
/// <see cref="FleetVesselSilence"/> on <c>silence.&lt;guid&gt;.state</c> stays
/// authoritative for one vessel on that vessel's own light-time; this is the
/// fleet-wide index, and is not a substitute for it.</para>
/// </summary>
/// <category>Solar system and fleet</category>
[SitrepContract]
[SitrepTopic("fleet.silence")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class FleetSilence
{
    /// <summary>One entry per vessel the tracker holds a reckoning for, in no guaranteed order. Never null; empty when there are none.</summary>
    public IReadOnlyList<FleetSilenceEntry> Vessels { get; set; } = new List<FleetSilenceEntry>();
}
