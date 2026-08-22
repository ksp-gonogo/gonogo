namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// Resolves a RACommLink's forward/reverse rates onto the operator's
    /// downlink/uplink axis, orientation-aware.
    ///
    /// <para><b>Why this is not a fixed mapping.</b> RA's <c>FwdDataRate</c> is the
    /// throughput in the link's stored <c>a -&gt; b</c> direction, and RA assigns
    /// <c>a</c>/<c>b</c> by NODE INDEX, not by vessel-vs-home role
    /// (<c>Precompute</c> calls <c>MakeLink(..., a: Nodes[x], b: Nodes[y])</c> with
    /// <c>x &lt;= y</c>). So whether <c>Fwd</c> is the vessel-to-home (downlink) or
    /// home-to-vessel (uplink) direction depends on the arbitrary registration
    /// order of the two endpoints, which is exactly why the old fixed
    /// <c>Down = Fwd, Up = Rev</c> mapping was flagged in-code as possibly swapped.
    /// RA's own <c>RACommNetwork.MaxDataRateToHome</c> resolves it the same way this
    /// does: by checking which endpoint the path is traversing FROM.</para>
    ///
    /// <para>Pure and KSP-free so it is exercised headlessly; the caller supplies
    /// <paramref name="forwardIsDownlink"/> (whether the link's <c>a</c> node is
    /// the vessel side, so <c>a -&gt; b</c> runs vessel-to-home).</para>
    /// </summary>
    public static class RaLinkDirection
    {
        /// <summary>
        /// (uplink = home-to-vessel, downlink = vessel-to-home) bits/sec.
        /// <paramref name="forwardIsDownlink"/> true means <c>Fwd</c> is the
        /// vessel-to-home direction, so downlink is <c>Fwd</c> and uplink is
        /// <c>Rev</c>; false swaps them.
        /// </summary>
        public static (double up, double down) Resolve(
            bool forwardIsDownlink, double forwardBitsPerSec, double reverseBitsPerSec) =>
            forwardIsDownlink
                ? (reverseBitsPerSec, forwardBitsPerSec)
                : (forwardBitsPerSec, reverseBitsPerSec);
    }
}
