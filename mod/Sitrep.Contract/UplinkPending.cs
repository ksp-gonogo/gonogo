using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One entry in the ground-side pending-uplink queue, backing
/// <c>system.uplink.pending</c> (see <c>ChannelEngine.UplinkPendingTopic</c>).
///
/// <para><b>Prediction-only, hard invariant:</b> this type carries ONLY
/// dispatch-time facts: what the centre sent and when. It must NEVER grow
/// an execution/result/vessel-derived field (e.g. whether the craft actually
/// received or ran the command, any onboard state). That distinction is what
/// keeps the queue "predicted, not confirmed", the client renders these
/// entries as in-flight until they naturally age out, never as an
/// acknowledgement of vessel-side effect. <c>Sitrep.Host.Tests.UplinkPendingShapeTests</c>
/// (a G1 shape ratchet with NO additive carve-out, unlike
/// <c>ContractShapeGateTests</c>) enforces the field set stays exactly this
/// seven.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PendingUplink
{
    /// <summary>== the dispatch <c>CommandRequest.RequestId</c>, the correlation key.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>Wire command name (e.g. <c>kos.run</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string Command { get; set; } = "";

    /// <summary>Caller-supplied envelope label; empty ⇒ the renderer falls back to <see cref="Command"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary>
    /// Dispatch-time addressing, which part/route the command was sent to
    /// (an opaque MQTT-style route, e.g. <c>kos/7</c>), known at the command
    /// centre at send time. NOT vessel state and NOT an execution result, so
    /// it stays inside the prediction-only invariant; it lets a renderer
    /// scope entries to one part/terminal. Empty ⇒ unscoped.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";

    /// <summary>
    /// Which command centre / ground station dispatched this command
    /// (available at dispatch as <c>job.Vantage</c>): dispatch-time
    /// command-centre bookkeeping, not vessel state, so it stays inside the
    /// prediction-only invariant. Future-proofs multiple command sources
    /// without a later contract migration.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Vantage { get; set; } = "";

    /// <summary>UT the engine dispatched the command.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double DispatchedAt { get; set; }

    /// <summary>One-way signal delay (seconds) AT DISPATCH, frozen, not re-read as the delay changes.</summary>
    [SitrepUnit(Units.Seconds)]
    public double OneWaySeconds { get; set; }

    /// <summary>
    /// The scalar this command asked for, when its command is one half of a
    /// declared <see cref="SitrepControlChannelAttribute"/> channel: a throttle
    /// setting, a switch as 1 or 0, an SAS mode as its ordinal. Null for every
    /// other command, and for a channel command whose args did not carry the
    /// value key.
    /// </summary>
    ///
    /// <remarks>
    /// <para><b>Inside the prediction-only invariant, not an exception to
    /// it.</b> The invariant on this class forbids an execution/result/
    /// vessel-derived field: whether the craft received or ran the command, any
    /// onboard state. A commanded value is none of those. It is the most
    /// on-point example of "what the centre sent", which is what the invariant
    /// says this type carries, and the system already knows it because it
    /// dispatched it: carrying it is not new information and not an inference
    /// about the craft.</para>
    ///
    /// <para><b>Why it is needed.</b> Without it the queue says a SAS command is
    /// in flight and cannot say which mode it asked for, so a renderer can show
    /// that something is happening and not what. An optimistic expectation, and
    /// the render it exists for (one control in a group marked out from its
    /// siblings), both need the value. It is also the only path a SECOND command
    /// centre or a station screen has to it: own-dispatch memory is per-client
    /// by construction.</para>
    ///
    /// <para>ONE numeric field rather than a variant because the channel's own
    /// declared args type already says how to read the number back, and because
    /// the coverage gate requires a channel's value field to be a scalar. See
    /// <see cref="ControlChannelDescriptor"/> for the reflected lookup.</para>
    ///
    /// <para><c>Sitrep.Host.Tests.UplinkPendingShapeTests</c> pins the field set
    /// and was deliberately written with no additive carve-out. This addition
    /// was asked for explicitly rather than slipped past it; the test carries
    /// the same reasoning.</para>
    /// </remarks>
    [SitrepUnit(Units.NotApplicable)]
    public double? CommandedValue { get; set; }
}

/// <summary>Wire wrapper for <c>system.uplink.pending</c>: the whole queue, resampled every emission.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PendingUplinkQueue
{
    public List<PendingUplink> Pending { get; set; } = new List<PendingUplink>();
}
