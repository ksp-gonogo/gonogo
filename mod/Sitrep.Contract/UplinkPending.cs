using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One entry in the ground-side pending-uplink queue, backing
/// <c>system.uplink.pending</c>.
///
/// <para><b>Prediction-only, hard invariant:</b> this type carries ONLY
/// dispatch-time facts: what the centre sent and when. It never carries an
/// execution, result or vessel-derived field (e.g. whether the craft actually
/// received or ran the command, any onboard state). That is what keeps the
/// queue "predicted, not confirmed": render these entries as in flight until
/// they age out, never as an acknowledgement of a vessel-side effect.</para>
/// <internal>
/// <c>Sitrep.Host.Tests.UplinkPendingShapeTests</c> pins the field set, with
/// no additive carve-out (unlike <c>ContractShapeGateTests</c>). The topic
/// constant is <c>ChannelEngine.UplinkPendingTopic</c>.
/// </internal>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PendingUplink
{
    /// <summary>
    /// The ENGINE's own id for this dispatch, unique within this queue.
    ///
    /// <para>NOT the <c>requestId</c> a client put on its <c>command-request</c>,
    /// and not relatable to it: the engine mints this separately and the two
    /// counters can collide. A client looking for its OWN dispatch here matches on
    /// <see cref="ClientRequestId"/>, which is that <c>requestId</c> carried
    /// through verbatim.</para>
    /// <internal>
    /// ChannelEngine.NextRequestId(), minted in ProcessDispatchCommand and passed
    /// to Courier.DispatchCommand; the socket handler's req.RequestId reaches the
    /// job only as <see cref="ClientRequestId"/>.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>
    /// The <c>requestId</c> the dispatching client put on its <c>command-request</c>,
    /// carried through verbatim, so that client can find its OWN entry in this queue.
    /// Empty when the dispatch did not come over a client connection.
    ///
    /// <para>Only the dispatching client's own choice, so two clients can pick the
    /// same value: match it together with <see cref="Command"/>, and read it as
    /// "this entry is mine" only on the connection that sent the request.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string ClientRequestId { get; set; } = "";

    /// <summary>Wire command name (e.g. <c>kos.run</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string Command { get; set; } = "";

    /// <summary>Caller-supplied envelope label, carried verbatim; empty when none was given, in which case show <see cref="Command"/> instead.</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary>
    /// Dispatch-time addressing, which part/route the command was sent to
    /// (an opaque MQTT-style route, e.g. <c>kos/7</c>), known at the command
    /// centre at send time. NOT vessel state and NOT an execution result, so
    /// it stays inside the prediction-only invariant; it lets a renderer
    /// scope entries to one part/terminal. Empty when unscoped.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";

    /// <summary>
    /// Which command centre / ground station dispatched this command:
    /// dispatch-time command-centre bookkeeping, not vessel state, so it stays inside the prediction-only
    /// invariant.
    /// <internal>
    /// Read from <c>job.Vantage</c> at dispatch.
    /// </internal>
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
    /// setting, a switch as 1 or 0, an SAS mode as its ordinal. ABSENT (the key
    /// is omitted, never written as null) for every other command, and for a
    /// channel command whose args did not carry the value key, so a zero
    /// throttle and an unknown value never look the same.
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
    /// <para>With it, a renderer can show WHICH SAS mode is in flight rather than
    /// only that something is, and mark one control in a group out from its
    /// siblings. It is also the only path a SECOND command centre or a station
    /// screen has to the value: own-dispatch memory is per-client.</para>
    ///
    /// <para>ONE numeric field rather than a variant because the channel's own
    /// declared args type already says how to read the number back. See
    /// <see cref="ControlChannelDescriptor"/> for the reflected lookup.</para>
    /// </remarks>
    // JsonWriter.AppendPendingUplink omits the key on !HasValue, so a zero throttle and an unknown value never arrive looking the same.
    [SitrepUnit(Units.NotApplicable)]
    [SitrepOmittedWhenNull]
    public double? CommandedValue { get; set; }
}

/// <summary>Wire wrapper for <c>system.uplink.pending</c>: the whole queue, resampled every emission.</summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PendingUplinkQueue
{
    /// <summary>
    /// Every command still believed in flight that this session may know of, in
    /// no guaranteed order: the ones dispatched at its own vantage, and the ones
    /// it dispatched itself under another. Empty, never null, when nothing is
    /// pending.
    /// </summary>
    public List<PendingUplink> Pending { get; set; } = new List<PendingUplink>();
}
