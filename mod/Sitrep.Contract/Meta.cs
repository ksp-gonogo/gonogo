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
    /// Carries no unit type, alone among the contract's UT fields and
    /// deliberately: the envelope rides on every
    /// message and nothing renders these, so ten transport and timeline files
    /// do arithmetic on them and a wrapper would allocate twice per message on
    /// the hottest path for a quantity no readout shows. The unit is declared
    /// on the property either way, it just does not become a type.
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
    /// Carries no unit type for the same reason as <see cref="ValidAt"/>.
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
/// The slim, payload-specific sibling of <see cref="Meta"/>, carried on
/// every <c>vessel.*</c>/<c>time.warp</c> PAYLOAD (<c>VesselOrbit.Meta</c>,
/// <c>VesselIdentity.Meta</c>, etc.), as opposed to the ENVELOPE <see cref="Meta"/>
/// that <c>Sitrep.Core.Courier</c> stamps onto every <c>StreamData&lt;T&gt;</c>
/// with the real <c>seq</c>/<c>deliveredAt</c>/<c>vantage</c>/<c>validAt</c>
/// (see <c>Courier.MakeMeta</c>). Before this type existed, every payload
/// carried a full <see cref="Meta"/> of its own, fabricating
/// <c>seq:0</c>/<c>deliveredAt:0</c>/<c>vantage:""</c>/<c>validAt:0</c>:
/// dead duplicates of the envelope's real values that a consumer could
/// easily mistake for genuine delivery metadata. <see cref="Source"/>
/// (subject provenance, <c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and
/// <see cref="Quality"/> (on-rails/loaded) are the only two fields a payload
/// mapper actually produces itself: everything else belongs to the
/// envelope alone. Staleness is a separate, not-yet-implemented M2 concern
/// and deliberately has no home here either.
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
