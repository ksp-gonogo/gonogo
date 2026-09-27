using System;
using System.Collections.Generic;

namespace Sitrep.Host.Science
{
    /// <summary>
    /// How long a stock transmitter takes to send a queue of results, reproducing
    /// <c>ModuleDataTransmitter.transmitQueuedData</c>: each result goes as
    /// <c>ceil(amount / packetSize)</c> packets one <c>packetInterval</c> apart, and
    /// the transmitter waits two intervals before starting the next result.
    /// </summary>
    public static class ScienceTransmissionStream
    {
        /// <summary>
        /// The stream time for <paramref name="amounts"/> (data per result, Mits),
        /// or 0 for an empty queue. A non-positive packet size or interval sends
        /// nothing measurable and also answers 0.
        /// </summary>
        public static double Seconds(IReadOnlyList<double> amounts, double packetSize, double packetInterval)
        {
            if (amounts.Count == 0 || packetSize <= 0 || packetInterval <= 0)
            {
                return 0;
            }

            var packets = 0.0;
            foreach (var amount in amounts)
            {
                packets += Math.Ceiling(Math.Max(0, amount) / packetSize);
            }
            var gaps = 2 * (amounts.Count - 1);
            return (packets + gaps) * packetInterval;
        }
    }
}
