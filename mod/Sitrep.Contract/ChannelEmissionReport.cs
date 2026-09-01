using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One declared channel's emission counters, plus the four engine facts a
/// reader needs to interpret them.
///
/// <para><b>The distinction this type exists to make.</b> From outside the mod,
/// a Topic that delivers no frames looks the same whatever the cause. Two of
/// those causes are completely different investigations and the counters
/// separate them:</para>
///
/// <list type="bullet">
/// <item><description><see cref="Considered"/> is 0: the engine never called
/// <c>ChannelEmitter.Decide</c> for this channel at all, so no emission policy
/// was ever consulted. The cause is upstream of the emitter, and the four flags
/// below say which one</description></item>
/// <item><description><see cref="Considered"/> is above 0 while
/// <see cref="Emitted"/> stays put and <see cref="Skipped"/> climbs: the engine
/// did produce values and the emitter declined them. The cause is the mapper's
/// value, the deadband, or the cadence gate, all of which live inside
/// <c>ChannelEmitter.Decide</c> and <c>ChannelDeclaration.Emission</c></description></item>
/// </list>
///
/// <para><b><see cref="Emitted"/> is never 0 once
/// <see cref="Considered"/> is above 0</b>, and the floor of 1 is worth knowing
/// before reading one of these: a channel's first consideration is an
/// unconditional keyframe (<c>ChannelEmitter</c>'s force-keyframe state, re-armed
/// on every subscribe and every timeline reset), so a considered channel has
/// emitted at least once by construction. The second case above therefore reads
/// as an <see cref="Emitted"/> that is small and static rather than zero, and
/// the useful comparison is against <see cref="Skipped"/>, not against
/// nothing.</para>
///
/// <para>That floor is itself a finding when a capture saw no frames at all:
/// <see cref="Emitted"/> above 0 with an empty capture means the sample was made
/// and lost downstream of the emitter, in the reveal gate, the
/// freeze-on-disconnect gate, or the wire, none of which these counters
/// see.</para>
///
/// <para>For the first case, read the flags in this order.
/// <see cref="Subscribers"/> at 0 is the ordinary answer and means nobody
/// looked: a channel with no subscriber is deliberately never sampled (the
/// outer gate, <c>SubscriptionRegistry</c>). With a subscriber present,
/// <see cref="Available"/> false means the owning uplink went inert and took
/// every channel it owns with it, <see cref="TickMapped"/> false means nothing
/// ever pushed a value at a publish-driven channel, and
/// <see cref="Born"/> false on a tick-mapped channel means the mapper returned
/// null on every tick and the birth gate held it back.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ChannelEmissionEntry
{
    /// <summary>The channel's Topic id.</summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";

    /// <summary>
    /// Total <c>ChannelEmitter.Decide</c> calls for this channel since the mod
    /// loaded, emitted or not. Never reset by a quickload:
    /// <c>ChannelEmitter.Reset</c> re-arms the keyframe and drops the
    /// churn-run state, and leaves the counters alone, so this is a
    /// process-lifetime total rather than a per-timeline one.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public long Considered { get; set; }

    /// <summary>Of those, how many the emitter chose to emit.</summary>
    [SitrepUnit(Units.Count)]
    public long Emitted { get; set; }

    /// <summary>
    /// <see cref="Considered"/> minus <see cref="Emitted"/>: considered and
    /// declined, by the cadence gate, the deadband, or the max-rate clamp.
    /// Carried rather than left to the reader to subtract, because a consumer
    /// that is not TypeScript reads this off the wire with no contract to
    /// derive it from.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public long Skipped { get; set; }

    /// <summary>
    /// How many subscribers the outer gate currently counts for this channel.
    /// 0 means the engine is deliberately not sampling it, which is the
    /// ordinary reason <see cref="Considered"/> stops moving.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int Subscribers { get; set; }

    /// <summary>
    /// Whether the channel's owning uplink is currently available. False means
    /// the uplink's registration threw or one of its mappers threw on an
    /// earlier tick, at which point every channel it owns goes inert together,
    /// not just the one that failed.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Available { get; set; }

    /// <summary>
    /// Whether this channel has ever carried a non-null value. False plus a
    /// subscriber plus a tick-driven mapper is the birth gate: the mapper has
    /// returned null every tick, and a channel that has never had a real value
    /// is held back rather than tombstoned, unless it opts into
    /// <c>ChannelDeclaration.AbsenceIsData</c>.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Born { get; set; }

    /// <summary>
    /// Whether the engine holds a Tick-driven mapper for this channel. False is
    /// normal and means the channel is publish-driven: an uplink pushes to it
    /// through an <c>IChannelPublisher</c> or a dynamic namespace, so it is
    /// only ever considered when something publishes.
    ///
    /// <para>False with a subscriber and no considerations therefore says
    /// nothing produced a value for this topic, which covers both a
    /// publish-driven channel that has stayed quiet and a channel declared
    /// with no producer wired at all. The next thing to look at is the same
    /// either way: who was supposed to publish here.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool TickMapped { get; set; }
}

/// <summary>
/// Wire wrapper for <c>system.channels</c>: every declared channel's emission
/// counters, sorted by Topic. See <see cref="ChannelEmissionEntry"/> for what
/// the numbers separate.
///
/// <para><b>Every declared channel, including the ones nobody is watching.</b>
/// A channel filtered out for having no subscriber would be absent from the
/// payload, and absent is indistinguishable from never declared, which is the
/// exact ambiguity this Topic exists to remove. So the roster is complete and
/// <see cref="ChannelEmissionEntry.Subscribers"/> carries the "nobody looked"
/// answer instead.</para>
///
/// <para><b>The report counts itself, and is behind by design.</b>
/// <c>system.channels</c> is a declared, tick-mapped channel like any other, so
/// it appears in its own roster with its own counters. Its row is built by its
/// own mapper, which runs BEFORE the engine's <c>Decide</c> call for it, so its
/// <see cref="ChannelEmissionEntry.Considered"/> is always at least one behind
/// the frame carrying it and its <see cref="ChannelEmissionEntry.Emitted"/>
/// never includes that frame. Every other row is a snapshot taken partway
/// through a tick as well: a channel whose mapper has not yet run on that tick
/// reads one consideration behind. The rows are also rebuilt on a throttle (see
/// <c>ChannelEngine.ChannelCounterIntervalSec</c>) rather than per tick, so
/// they can be up to that interval older than the frame's own timestamp. None
/// of that affects what the Topic is for: the difference between zero and
/// non-zero is what carries the diagnosis, and neither the lag nor the throttle
/// can turn one into the other.</para>
///
/// <para>Carries no <see cref="SitrepTopicAttribute"/>, matching
/// <see cref="CommandGateReport"/> and the rest of the engine-declared
/// <c>system.*</c> family. That tag reflects a Topic an uplink owns, and no
/// uplink owns this one: <c>ChannelEngine</c> declares and sources it directly
/// because it reports on every OTHER channel. The SDK picks it up as a
/// hand-declared entry in its own <c>topics.ts</c>, the same treatment
/// <c>system.uplink.gates</c> and <c>system.units</c> get.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ChannelEmissionReport
{
    public List<ChannelEmissionEntry> Channels { get; set; } = new List<ChannelEmissionEntry>();
}
