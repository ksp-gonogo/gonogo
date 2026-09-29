#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Whether a payload's subject is simulated under physics
/// (<see cref="Loaded"/>) or moving on rails (<see cref="OnRails"/>).
/// </summary>
/// <category>Stream messages</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum Quality
{
    /// <summary>Moving on rails: KSP is not simulating it, and its orbit is a fixed conic.</summary>
    OnRails,

    /// <summary>Loaded and simulated under physics.</summary>
    Loaded,
}

/// <summary>
/// How current a delivered sample is, as the mod knows it (a client infers
/// the rest from its own heartbeat tracking).
///
/// <para><see cref="Fresh"/> is a sample delivered on its own schedule.
/// <see cref="Held"/> and <see cref="LastBeforeBlackout"/> are catch-up
/// grades for a late or reconnecting subscriber.
/// <see cref="Recorded"/> is different in kind from all three: the sample is
/// exact as of its own <see cref="Meta.ValidAt"/>, it simply did not travel at
/// the time it was taken. It was held aboard through a loss of signal and dumped
/// on acquisition, so it arrives long after the instant it describes, and its
/// <see cref="Meta.DeliveredAt"/> is the real arrival, not
/// <c>validAt + light-time</c>.</para>
/// </summary>
/// <category>Stream messages</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum Staleness
{
    /// <summary>
    /// Delivered on its own schedule. An old <c>validAt</c> on a Topic that sends only
    /// on change is still fresh.
    /// </summary>
    Fresh,
    /// <summary>
    /// Sent to a subscriber that joined while contact was lost, and taken after contact
    /// was lost.
    /// </summary>
    Held,
    /// <summary>
    /// Sent to a subscriber that joined while contact was lost: the last sample that
    /// got out before contact was lost.
    /// </summary>
    LastBeforeBlackout,

    /// <summary>
    /// Recovered from the subject's own recorder: taken while it was out of
    /// contact, replayed on reacquisition. Precisely dated and never a guess,
    /// but not a live reading, and never the subject's current state.
    /// </summary>
    Recorded,
}

/// <summary>
/// The envelope every stream sample, event and command reply carries: where
/// it was observed from, when it was true in the game, when it was delivered,
/// and how current it is.
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Meta
{
    /// <summary>The node the sample was read from.</summary>
    [SitrepUnit(Units.Id)]
    public string Source { get; set; } = "";

    /// <summary>
    /// When the payload was true in the game, in seconds of KSP universal time,
    /// the same base every <c>*Ut</c> field on every payload uses. This is the
    /// instant a reading is "as of", and the one a client compares against its
    /// view time to decide currency.
    ///
    /// <para>A plain number in the TypeScript type, not a <c>Value</c> wrapper;
    /// its unit is still <c>"ut"</c>.</para>
    /// <internal>
    /// The unit reaches a client through <c>units.json</c> rather than the
    /// emitted type: the <c>Value&lt;"ut"&gt;</c> retyping pass runs over wire
    /// payload types only, so this stays a bare number in <c>contract.ts</c>, as
    /// every command-args field does. Keeping the envelope out of that pass is
    /// deliberate: nothing renders these, transport and timeline code does
    /// arithmetic on them, and the envelope rides every message, so a wrapper
    /// would allocate twice per message on the hottest path.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double ValidAt { get; set; }
    /// <summary>A number that rises by one with every frame the mod sends.</summary>
    [SitrepUnit(Units.Id)]
    public long Seq { get; set; }

    /// <summary>
    /// When the mod handed the message to the transport, in the same universal
    /// time seconds as <see cref="ValidAt"/>. The two differ by the signal delay
    /// the vantage is under, so subtracting one from the other is how old the
    /// payload was when it arrived, and they are equal on a zero-delay link. A
    /// plain number in the TypeScript type, as <see cref="ValidAt"/> is.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double DeliveredAt { get; set; }

    /// <summary>
    /// The place the payload was observed from: a <c>commandCentre.roster</c> id,
    /// <c>"meta"</c> for an instant-class topic no distance applies to, or empty
    /// when the connection is at no command centre because none is active.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Vantage { get; set; } = "";

    /// <summary>
    /// Whether the payload's subject is under physics: <see cref="Quality.Loaded"/>
    /// while KSP simulates the craft, when its orbital elements are osculating
    /// rather than a coast a conic may advance, and <see cref="Quality.OnRails"/>
    /// otherwise, including for a payload that describes no craft. The payload's
    /// own <c>meta.quality</c>, carried onto the envelope.
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public Quality Quality { get; set; }
    /// <summary>Always true on a frame the mod sends.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Active { get; set; }
    /// <summary>How current the sample is.</summary>
    [SitrepUnit(Units.Enumeration)]
    public Staleness Staleness { get; set; }

    /// <summary>
    /// Generation counter for the current timeline: <c>0</c> when the mod
    /// starts, incremented once for every quickload or rewind. Carried on every
    /// envelope, streams and command responses alike, so a sample from an
    /// abandoned pre-rewind timeline can be told apart. A client compares it
    /// against its own last-seen epoch to detect a rewind, rather than inferring
    /// one from a backward <c>validAt</c> jump, which a reordered or coalesced
    /// delivery could mask.
    /// <internal>Incremented by <c>Courier.ResetTimeline</c>, stamped by
    /// <c>Courier.MakeMeta</c>.</internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int TimelineEpoch { get; set; }

    /// <summary>
    /// The <see cref="ValidAt"/> of the last sample on this topic that precedes
    /// a KNOWN break in the record, set only on the first sample delivered after
    /// that break and <c>null</c> on every other sample.
    ///
    /// <para>Non-null is a positive claim, not an absence: data existed between
    /// this universal time and the carrying sample's own <see cref="ValidAt"/>, and it is
    /// gone. Two things produce one. A blackout recording that overran its
    /// storage bound had its oldest span dropped, so the replay resumes mid-hole.
    /// A channel that does not record at all (a session fact, never aboard the
    /// craft: see <see cref="ChannelDeclaration.Recordable"/>) has no replay, so its
    /// first post-blackout sample carries the whole outage as the gap.</para>
    ///
    /// <para>A client draws it as a break rather than joining across it: a line
    /// interpolated through an outage looks like data. Omitted from the wire
    /// when there is no gap, the only <see cref="Meta"/> field that is.</para>
    /// </summary>
    // EnvelopeCodec.AppendMeta omits the key on HasValue, alone among Meta's fields, so ordinary frames do not carry a null.
    [SitrepUnit(Units.UniversalTime)]
    [SitrepOmittedWhenNull]
    public double? GapSinceUt { get; set; }
}

/// <summary>
/// The slim, payload-specific sibling of <see cref="Meta"/>, carried inside
/// payloads such as every <c>vessel.*</c> one and <c>time.warp</c>
/// (<c>VesselOrbit.Meta</c>, <c>VesselIdentity.Meta</c> and so on).
///
/// <para>It says what the payload is about, and nothing about its delivery.
/// <c>seq</c>, <c>deliveredAt</c>, <c>vantage</c> and <c>validAt</c> are on the
/// envelope <see cref="Meta"/>, one per <c>stream-data</c> frame: read those
/// there.</para>
///
/// <para><see cref="Source"/> is the subject's provenance, and takes one of two
/// forms: <c>"vessel:&lt;guid&gt;"</c> when the payload describes one craft, or
/// <c>"game"</c> when it describes the session. <see cref="Quality"/> says
/// whether that craft is on rails or fully loaded. Those two are the whole of
/// this type.</para>
///
/// <internal>
/// Filled by each ViewProvider's payload mapper; the envelope <see cref="Meta"/>
/// is stamped separately by <c>Sitrep.Core.Courier.MakeMeta</c>. Source and
/// Quality are the only two fields a payload mapper produces itself.
/// </internal>
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PayloadMeta
{
    /// <summary>
    /// <c>"vessel:&lt;guid&gt;"</c> when the payload describes one craft, or
    /// <c>"game"</c> when it describes the session.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Source { get; set; } = "";
    /// <summary>Whether the craft is on rails or loaded under physics.</summary>
    [SitrepUnit(Units.Enumeration)]
    public Quality Quality { get; set; }
}
