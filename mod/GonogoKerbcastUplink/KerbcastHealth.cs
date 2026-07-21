using Sitrep.Contract;

namespace Gonogo.KerbcastUplink
{
    /// <summary>
    /// The kerbcast MANDATORY HEALTHCHECK — as a pure function.
    ///
    /// <para>This is the reason the kerbcast Uplink exists. Before it, the only
    /// "Kerbcast health" surface read the browser's own
    /// <c>KerbcastDataSource.status</c> — a client-side view of a separate
    /// WebRTC connection, which bypassed the mod contract entirely and was
    /// deleted in <c>45111e44</c> ("the Uplinks list is contract-only"). An
    /// Uplink gets a healthcheck for free by implementing
    /// <see cref="ISitrepUplink.Health"/>; a bolted-on DataSource does not.
    /// This is that healthcheck.</para>
    ///
    /// <para>Extracted from <see cref="KerbcastUplink"/> as a pure function over
    /// four inputs so it can be exercised headless: the live uplink only ever
    /// touches KSP, and a state machine that decides what an operator is told
    /// when their camera feed is black deserves tests, not a live-only code
    /// path.</para>
    /// </summary>
    public static class KerbcastHealth
    {
        /// <summary>
        /// Decides the health state.
        ///
        /// <para>The three degraded cases are deliberately distinct, because
        /// they send the operator to three different places: an INSTALL problem
        /// (kerbcast isn't there), a SCENE problem (you're in the VAB, kerbcast's
        /// capture core only runs in flight), or a CRAFT problem (you flew
        /// something with no camera on it). "Black feed" alone can't tell those
        /// apart; this can.</para>
        /// </summary>
        /// <param name="unavailableReason">
        /// Non-null when the uplink went inert at registration (kerbcast absent,
        /// or its reflection surface moved). Wins over everything else.
        /// </param>
        /// <param name="sampledOnce">Whether the main-thread capture has run at least once.</param>
        /// <param name="coreActive">Whether kerbcast's capture core reported itself live at the last sample.</param>
        /// <param name="cameraCount">Cameras seen on the active vessel at the last sample.</param>
        public static UplinkHealth Evaluate(
            string? unavailableReason, bool sampledOnce, bool coreActive, int cameraCount)
        {
            if (unavailableReason != null)
            {
                return new UplinkHealth(UplinkHealthState.Unavailable, unavailableReason);
            }
            if (!sampledOnce)
            {
                // Registered fine, but nothing has been observed yet. Not
                // Healthy (we'd be claiming a camera count we don't have) and
                // not Unavailable (kerbcast is right there).
                return new UplinkHealth(UplinkHealthState.Degraded,
                    "kerbcast installed; waiting for the first sample");
            }
            if (!coreActive)
            {
                return new UplinkHealth(UplinkHealthState.Degraded,
                    "kerbcast installed, but its capture core is not running (no flight scene)");
            }
            if (cameraCount <= 0)
            {
                return new UplinkHealth(UplinkHealthState.Degraded,
                    "kerbcast running, but the active vessel carries no camera parts");
            }
            return new UplinkHealth(UplinkHealthState.Healthy,
                cameraCount == 1 ? "1 camera" : cameraCount + " cameras");
        }
    }
}
