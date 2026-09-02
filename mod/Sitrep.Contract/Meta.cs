#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum Quality { OnRails, Loaded }

#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum Staleness { Fresh, HeldStale, LastBeforeBlackout }

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Meta
{
    [SitrepUnit(Units.Id)]
    public string Source { get; set; } = "";

    /// <summary>
    /// When the payload was TRUE in the game, in UT seconds (KSP universal
    /// time), the same base every <c>*Ut</c> field on every payload uses. This
    /// is the instant a reading is "as of", and the one a client compares
    /// against its view time to decide currency.
    ///
    /// The unit IS declared, and reaches a client through the units map rather
    /// than through the emitted type: the <c>Value&lt;"ut"&gt;</c> retyping pass
    /// runs over wire PAYLOAD types only, so this stays a bare number in
    /// <c>contract.ts</c> and carries <c>"ut"</c> in <c>units.json</c>. Every
    /// command-args field does the same; reading only the type under-reports the
    /// declaration.
    ///
    /// Keeping the envelope out of that pass is deliberate: nothing renders
    /// these, ten transport and timeline files do arithmetic on them, and the
    /// envelope rides every message, so a wrapper would allocate twice per
    /// message on the hottest path for a quantity no readout shows.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double ValidAt { get; set; }
    [SitrepUnit(Units.Id)]
    public long Seq { get; set; }

    /// <summary>
    /// When the server handed the message to the transport, in the same UT
    /// seconds as <see cref="ValidAt"/>. The two differ by the signal delay the
    /// vantage is under, so subtracting one from the other is how old the
    /// payload was when it arrived, and they are equal on a live (zero-delay)
    /// link.
    /// Declared, and bare in the emitted type, as <see cref="ValidAt"/> is.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double DeliveredAt { get; set; }
    [SitrepUnit(Units.Id)]
    public string Vantage { get; set; } = "";
    [SitrepUnit(Units.Enumeration)]
    public Quality Quality { get; set; }
    [SitrepUnit(Units.Flag)]
    public bool Active { get; set; }
    [SitrepUnit(Units.Enumeration)]
    public Staleness Staleness { get; set; }

    /// <summary>
    /// Generation counter for the current timeline: 0 at boot, incremented
    /// once for every quickload/rewind (<see cref="Sitrep.Core.Courier.ResetTimeline"/>).
    /// Stamped on EVERY envelope <see cref="Meta"/> (streams AND command
    /// responses) by <c>Courier.MakeMeta</c>: see that method's doc
    /// comment for why this had to be added now rather than retrofitted
    /// later: once recordings/stations exist, a sample with no epoch can
    /// never be told apart from one on an abandoned pre-rewind timeline.
    /// A client compares this against its own last-seen epoch to detect a
    /// rewind atomically, without re-deriving it from a backward `validAt`
    /// jump (which a reordered/coalesced delivery could mask).
    /// </summary>
    [SitrepUnit(Units.Id)]
    public int TimelineEpoch { get; set; }
}

/// <summary>
/// The slim, payload-specific sibling of <see cref="Meta"/>, carried on every
/// <c>vessel.*</c> and <c>time.warp</c> PAYLOAD (<c>VesselOrbit.Meta</c>,
/// <c>VesselIdentity.Meta</c> and so on).
///
/// <para>It says what the payload is ABOUT, and nothing about its delivery. The
/// real <c>seq</c>, <c>deliveredAt</c>, <c>vantage</c> and <c>validAt</c> are on
/// the ENVELOPE <see cref="Meta"/>, one per <c>stream-data</c> frame: read those
/// there, never here.</para>
///
/// <para><see cref="Source"/> is the subject's provenance, and takes one of two
/// forms: <c>"vessel:&lt;guid&gt;"</c> when the payload describes one craft, or
/// <c>"game"</c> when it describes the session. <see cref="Quality"/> says
/// whether that craft is on rails or fully loaded. Those two are the whole of
/// this type.</para>
///
/// <internal>
/// <para>Stamped by <c>Sitrep.Core.Courier.MakeMeta</c> onto every
/// <c>StreamData&lt;T&gt;</c>. Before this type existed, every payload carried a
/// full <see cref="Meta"/> of its own, fabricating <c>seq:0</c>,
/// <c>deliveredAt:0</c>, <c>vantage:""</c> and <c>validAt:0</c>: dead duplicates
/// of the envelope's real values that a consumer could easily mistake for
/// genuine delivery metadata. Source and Quality are the only two fields a
/// payload mapper actually produces itself.</para>
///
/// <para>Staleness is a separate, not-yet-implemented M2 concern and
/// deliberately has no home here either.</para>
/// </internal>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PayloadMeta
{
    [SitrepUnit(Units.Id)]
    public string Source { get; set; } = "";
    [SitrepUnit(Units.Enumeration)]
    public Quality Quality { get; set; }
}
