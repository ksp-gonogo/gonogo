#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

#if NETSTANDARD2_0
[TsEnum]
#endif
public enum Quality { OnRails, Loaded }

#if NETSTANDARD2_0
[TsEnum]
#endif
public enum Staleness { Fresh, HeldStale, LastBeforeBlackout }

#if NETSTANDARD2_0
[TsInterface]
#endif
public class Meta
{
    public string Source { get; set; } = "";
    public double ValidAt { get; set; }
    public long Seq { get; set; }
    public double DeliveredAt { get; set; }
    public string Vantage { get; set; } = "";
    public Quality Quality { get; set; }
    public bool Active { get; set; }
    public Staleness Staleness { get; set; }
    public double? Confidence { get; set; }
}

/// <summary>
/// The slim, payload-specific sibling of <see cref="Meta"/> — carried on
/// every <c>vessel.*</c>/<c>time.warp</c> PAYLOAD (<c>VesselOrbit.Meta</c>,
/// <c>VesselIdentity.Meta</c>, etc.), as opposed to the ENVELOPE <see cref="Meta"/>
/// that <c>Sitrep.Core.Courier</c> stamps onto every <c>StreamData&lt;T&gt;</c>
/// with the real <c>seq</c>/<c>deliveredAt</c>/<c>vantage</c>/<c>validAt</c>
/// (see <c>Courier.MakeMeta</c>). Before this type existed, every payload
/// carried a full <see cref="Meta"/> of its own, fabricating
/// <c>seq:0</c>/<c>deliveredAt:0</c>/<c>vantage:""</c>/<c>validAt:0</c> —
/// dead duplicates of the envelope's real values that a consumer could
/// easily mistake for genuine delivery metadata. <see cref="Source"/>
/// (subject provenance, <c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and
/// <see cref="Quality"/> (on-rails/loaded) are the only two fields a payload
/// mapper actually produces itself — everything else belongs to the
/// envelope alone. Staleness is a separate, not-yet-implemented M2 concern
/// and deliberately has no home here either.
/// </summary>
#if NETSTANDARD2_0
[TsInterface]
#endif
public class PayloadMeta
{
    public string Source { get; set; } = "";
    public Quality Quality { get; set; }
}
