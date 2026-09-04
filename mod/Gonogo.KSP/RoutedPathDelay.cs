using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;

namespace Gonogo.KSP
{
    /// <summary>
    /// One-way light-time over an already-walked comms path, the shared
    /// primitive behind every routed delay the KSP layer reports: a vessel's
    /// own path home and an arbitrary node-to-node path both come through here,
    /// so the two can never drift.
    ///
    /// <para>The distinction between "no route exists" and "a route exists whose
    /// geometry sums to nothing" is the whole point of the nullable hop list: a
    /// null list is unroutable and yields null, never a zero standing in for a
    /// delay nobody can measure. An empty-but-present list means the caller
    /// found no hops to measure, which <see cref="SignalDelay.Compute"/> already
    /// reports as the no-measurable-path case.</para>
    /// </summary>
    internal static class RoutedPathDelay
    {
        /// <param name="hops">The walked path's hops, or null when no path exists at all.</param>
        /// <param name="config">The SignalDelay flag + light-speed scale.</param>
        /// <param name="quality">
        /// Carried through to the payload meta, which this method discards: only the
        /// seconds are read. Callers still pass what they know so the value stays
        /// honest if the meta is ever surfaced.
        /// </param>
        internal static double? OneWaySeconds(
            IReadOnlyList<CommsRouteHop>? hops,
            SignalDelayConfig? config,
            Quality quality)
        {
            if (hops == null)
            {
                return null;
            }

            var commsHops = new List<CommsHop>(hops.Count);
            foreach (var hop in hops)
            {
                commsHops.Add(new CommsHop
                {
                    From = string.Empty,
                    To = string.Empty,
                    Kind = hop.TouchesHome ? CommsHopKind.Home : CommsHopKind.Relay,
                    DistanceMeters = hop.DistanceMeters,
                });
            }

            return SignalDelay.Compute(config, new CommsPath { Hops = commsHops }, string.Empty, quality).OneWaySeconds;
        }
    }
}
