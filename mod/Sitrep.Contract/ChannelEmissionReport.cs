using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One declared channel's emission counters, plus the four engine facts a
/// reader needs to interpret them.
///
/// <para>From outside the mod, a Topic that delivers no frames looks the same
/// whatever the cause. The counters separate the two main causes:</para>
///
/// <list type="bullet">
/// <item><description><see cref="Considered"/> is 0: the mod never evaluated
/// this channel for emission at all. The cause is upstream of the emission
/// policy, and the four flags below say which one</description></item>
/// <item><description><see cref="Considered"/> is above 0 while <see
/// cref="Emitted"/> stays put and <see cref="Skipped"/> climbs: values were
/// produced and the emission policy declined them. The cause is the value
/// itself, the deadband, or the cadence gate, all set by the channel's
/// <see cref="ChannelDeclaration.Emission"/></description></item>
/// </list>
///
/// <para><see cref="Emitted"/> is never 0 once <see cref="Considered"/> is
/// above 0: a channel's first consideration is an unconditional keyframe (set
/// again on every subscribe and every timeline reset), so a considered channel
/// has emitted at least once. The second case above therefore reads as an
/// <see cref="Emitted"/> that is small and static rather than zero, and the
/// useful comparison is against <see cref="Skipped"/>.</para>
///
/// <para><see cref="Emitted"/> above 0 with no frames captured means the sample
/// was produced and lost further downstream (the reveal gate, the
/// freeze-on-disconnect gate, or the wire), none of which these counters
/// see.</para>
///
/// <para>For the first case, read the flags in this order. <see
/// cref="Subscribers"/> at 0 is the ordinary case and means nobody looked: a
/// channel with no subscriber is deliberately never sampled. With a subscriber
/// present, <see cref="Available"/> false means the owning Uplink went inert
/// and took every channel it owns with it, <see cref="TickMapped"/> false means
/// nothing ever pushed a value at a publish-driven channel, and <see
/// cref="Born"/> false on a tick-mapped channel means the mapper returned null
/// on every tick and the channel is held back until its first value.</para>
/// <internal>
/// A consideration is one <c>Sitrep.Core.ChannelEmitter.Decide</c> call; the
/// no-subscriber gate is <c>SubscriptionRegistry</c>; the keyframe floor is
/// <c>ChannelEmitter</c>'s force-keyframe state.
/// </internal>
/// </summary>
/// <category>System diagnostics</category>
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
    /// How many times the mod has evaluated this channel for emission since it
    /// loaded, emitted or not. A quickload does not reset it: this is a total
    /// for the life of the game process, not per timeline.
    /// <internal>Counts <c>ChannelEmitter.Decide</c> calls;
    /// <c>ChannelEmitter.Reset</c> restores the keyframe and drops the churn-run
    /// state and leaves the counters alone.</internal>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public long Considered { get; set; }

    /// <summary>Of those, how many the emission policy chose to emit.</summary>
    [SitrepUnit(Units.Count)]
    public long Emitted { get; set; }

    /// <summary>
    /// <see cref="Considered"/> minus <see cref="Emitted"/>: considered and
    /// declined, by the cadence gate, the deadband, or the max-rate clamp.
    /// Carried so a consumer need not subtract.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public long Skipped { get; set; }

    /// <summary>
    /// How many subscribers the mod currently counts for this channel. 0 means
    /// the mod is deliberately not sampling it, which is the ordinary reason
    /// <see cref="Considered"/> stops moving.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int Subscribers { get; set; }

    /// <summary>
    /// Whether the channel's owning Uplink is currently available. False means
    /// the Uplink's registration threw or one of its mappers threw on an
    /// earlier tick, at which point every channel it owns goes inert together,
    /// not just the one that failed.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Available { get; set; }

    /// <summary>
    /// Whether this channel has ever carried a non-null value. False with a
    /// subscriber and a tick-driven mapper means the mapper has returned null
    /// every tick: a channel that has never had a real value is held back
    /// rather than sent as absent, unless it opts into
    /// <see cref="ChannelDeclaration.AbsenceIsData"/>.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool Born { get; set; }

    /// <summary>
    /// Whether the mod holds a tick-driven mapper for this channel. False is
    /// normal and means the channel is publish-driven: an Uplink pushes to it
    /// through an <see cref="IChannelPublisher"/> or a dynamic namespace, so it
    /// is only ever considered when something publishes.
    ///
    /// <para>False with a subscriber and no considerations therefore says
    /// nothing produced a value for this topic, which covers both a
    /// publish-driven channel that has stayed quiet and a channel declared
    /// with no producer wired at all. Either way, the next thing to look at is
    /// who was supposed to publish here.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool TickMapped { get; set; }
}

/// <summary>
/// Wire wrapper for <c>system.channels</c>: every declared channel's emission
/// counters, sorted by Topic. See <see cref="ChannelEmissionEntry"/> for what
/// the numbers separate.
///
/// <para>Every declared channel is listed, including the ones nobody is
/// watching, so a channel missing from the roster was never declared;
/// <see cref="ChannelEmissionEntry.Subscribers"/> says "nobody looked".</para>
///
/// <para>The report counts itself and lags slightly. <c>system.channels</c>
/// appears in its own roster, and its row is built before its own frame is
/// evaluated, so its <see cref="ChannelEmissionEntry.Considered"/> is always at
/// least one behind the frame carrying it and its
/// <see cref="ChannelEmissionEntry.Emitted"/> never includes that frame. Any
/// other row can read one consideration behind too, and the rows are rebuilt
/// about every five seconds rather than every tick, so they can be up to that
/// much older than the frame's own timestamp. Neither lag can turn a zero into
/// a non-zero, which is the difference that carries the diagnosis.</para>
/// <internal>
/// The throttle is <c>ChannelEngine.ChannelCounterIntervalSec</c>. Carries no
/// <see cref="SitrepTopicAttribute"/>, matching <see cref="CommandGateReport"/>
/// and the rest of the engine-declared <c>system.*</c> family: no Uplink owns
/// this Topic, <c>ChannelEngine</c> declares and sources it directly. The SDK
/// picks it up as a hand-declared entry in its own <c>topics.ts</c>, as with
/// <c>system.uplink.gates</c> and <c>system.units</c>.
/// </internal>
/// </summary>
/// <category>System diagnostics</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ChannelEmissionReport
{
    /// <summary>One entry per declared channel, sorted by Topic id. Never null.</summary>
    public List<ChannelEmissionEntry> Channels { get; set; } = new List<ChannelEmissionEntry>();
}
