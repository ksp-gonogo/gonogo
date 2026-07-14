using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One entry in the ground-side pending-uplink queue, backing
/// <c>system.uplink.pending</c> (see <c>ChannelEngine.UplinkPendingTopic</c>).
///
/// <para><b>Prediction-only, hard invariant:</b> this type carries ONLY
/// dispatch-time facts — what the centre sent and when. It must NEVER grow
/// an execution/result/vessel-derived field (e.g. whether the craft actually
/// received or ran the command, any onboard state). That distinction is what
/// keeps the queue "predicted, not confirmed" — the client renders these
/// entries as in-flight until they naturally age out, never as an
/// acknowledgement of vessel-side effect. <c>Sitrep.Host.Tests.UplinkPendingShapeTests</c>
/// (a G1 shape ratchet with NO additive carve-out, unlike
/// <c>ContractShapeGateTests</c>) enforces the field set stays exactly this
/// six.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class PendingUplink
{
    /// <summary>== the dispatch <c>CommandRequest.RequestId</c>, the correlation key.</summary>
    public string Id { get; set; } = "";

    /// <summary>Wire command name (e.g. <c>kos.run</c>).</summary>
    public string Command { get; set; } = "";

    /// <summary>Caller-supplied envelope label; empty ⇒ the renderer falls back to <see cref="Command"/>.</summary>
    public string Label { get; set; } = "";

    /// <summary>
    /// Which command centre / ground station dispatched this command
    /// (available at dispatch as <c>job.Vantage</c>) — dispatch-time
    /// command-centre bookkeeping, not vessel state, so it stays inside the
    /// prediction-only invariant. Future-proofs multiple command sources
    /// without a later contract migration.
    /// </summary>
    public string Vantage { get; set; } = "";

    /// <summary>UT the engine dispatched the command.</summary>
    public double DispatchedAt { get; set; }

    /// <summary>One-way signal delay (seconds) AT DISPATCH, frozen — not re-read as the delay changes.</summary>
    public double OneWaySeconds { get; set; }
}

/// <summary>Wire wrapper for <c>system.uplink.pending</c> — the whole queue, resampled every emission.</summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class PendingUplinkQueue
{
    public List<PendingUplink> Pending { get; set; } = new List<PendingUplink>();
}
