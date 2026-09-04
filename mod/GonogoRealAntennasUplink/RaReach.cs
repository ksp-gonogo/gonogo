using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// RealAntennas' own reach rule: how far apart two nodes can be and still
    /// close a link BUDGET, which is a different question from stock's and
    /// answered in a different currency (dB, not antenna power against a range
    /// curve). The model <see cref="RaCommsBackend.ReachModel"/> hands back.
    ///
    /// <para><b>Why RA has to answer this itself.</b> RA zeroes both
    /// <c>antennaTransmit.power</c> and <c>antennaRelay.power</c> on every
    /// vessel, unconditionally, in <c>RACommNetVessel.UpdateComm</c>. Stock's
    /// rule read off those fields therefore reports a maximum range of ZERO for
    /// every craft in the game on an RA install: a permanent, plausible,
    /// catastrophic "nothing reaches" that would darken every contact
    /// prediction. Ground stations keep non-zero relay power, so the failure is
    /// not even uniform enough to notice as obviously broken. This is the same
    /// shape of trap as the routing one <c>RaRouting</c> exists for: the stock
    /// member is still THERE and still readable, it just no longer means what it
    /// says.</para>
    ///
    /// <para><b>The shorter of two directions.</b> RA carries a link only when
    /// the data rate is positive BOTH ways (its <c>Precompute</c> gate), so the
    /// pair's reach is the smaller of its two directional maxima rather than
    /// either one. An asymmetric pair, a big dish talking to a whip, closes
    /// outbound long after it has stopped closing inbound, and the generous
    /// direction is the wrong answer.</para>
    ///
    /// <para><b>The best antenna on each node.</b> A node carries a list of
    /// them and RA picks per link; unlinked, the honest bound is the pairing
    /// that reaches furthest, since the craft would use it if it could. That is
    /// deliberately the OPTIMISTIC choice within the pair, for the same reason
    /// the reach fallback asserts nothing: this rule may only ever shorten a
    /// prediction the geometry already allowed, so an over-tight bound invents
    /// blackouts that the game does not have.</para>
    ///
    /// <para>Best-effort, on exactly the terms <see cref="RaLinkBudget"/>
    /// already states: it re-derives RA's PUBLIC formulas and does not reproduce
    /// RA's negotiated-modulation tie-break, so the number is an estimate of RA's
    /// own rather than a bit-for-bit match. Absent rather than wrong whenever an
    /// input will not read.</para>
    /// </summary>
    internal static class RaReach
    {
        public const string ModelId = "realantennas-link-budget";

        public const string ModelName = "RealAntennas (link budget closes in dB)";

        /// <summary>
        /// The reach model for a pair of nodes, or
        /// <see cref="CommsReachModels.Unknown"/> when RA will not say: an
        /// unreadable handle, a node with no antennas, or a budget that resolves
        /// in neither direction.
        ///
        /// <para><b>Unknown, not zero, when nothing reads.</b> A zero would
        /// assert that RA carries this pair nowhere, and a reflection surface
        /// that has moved must degrade the prediction's FIDELITY rather than
        /// blacking it out. A pair RA genuinely cannot close at any distance is
        /// reported the same way, absent, because this rule cannot tell that
        /// case apart from a failed read: both come back as no solvable budget.
        /// Saying so is honest; guessing which one it was is not.</para>
        /// </summary>
        internal static ICommsReachModel Between(RaReflection? ra, object? from, object? to)
        {
            if (ra == null)
            {
                return CommsReachModels.Unknown;
            }

            try
            {
                var fromAntennas = ra.NodeAntennas(from);
                var toAntennas = ra.NodeAntennas(to);
                if (fromAntennas.Count == 0 || toAntennas.Count == 0)
                {
                    return CommsReachModels.Unknown;
                }

                var forward = BestDirection(ra, fromAntennas, toAntennas);
                var reverse = BestDirection(ra, toAntennas, fromAntennas);
                if (forward == null || reverse == null)
                {
                    return CommsReachModels.Unknown;
                }

                var limiting = Math.Min(forward.Value, reverse.Value);
                return new MaxRangeReachModel(ModelId, ModelName, limiting);
            }
            catch (Exception)
            {
                return CommsReachModels.Unknown;
            }
        }

        /// <summary>
        /// The furthest-reaching transmit/receive antenna pairing in ONE
        /// direction, or null when no pairing yields a solvable budget.
        /// </summary>
        private static double? BestDirection(
            RaReflection ra,
            IReadOnlyList<object> transmitters,
            IReadOnlyList<object> receivers)
        {
            double? best = null;
            foreach (var tx in transmitters)
            {
                var txPower = ra.TxPower(tx);
                var txGain = ra.Gain(tx);
                var frequency = ra.Frequency(tx);
                var symbolRate = ra.SymbolRate(tx);
                if (txPower == null || txGain == null || frequency == null || symbolRate == null)
                {
                    continue;
                }

                foreach (var rx in receivers)
                {
                    var rxGain = ra.Gain(rx);
                    if (rxGain == null)
                    {
                        continue;
                    }

                    // Same fail-soft constants the live margin already uses, so
                    // a moved RA surface degrades this number's fidelity rather
                    // than removing the rule.
                    var range = RaLinkBudget.MaxRangeMeters(
                        txPower.Value,
                        txGain.Value,
                        rxGain.Value,
                        frequency.Value,
                        ra.NoiseTemperatureKelvin(rx) ?? DefaultReceiverNoiseTempKelvin,
                        symbolRate.Value,
                        ra.RequiredEbN0Db(rx) ?? DefaultRequiredEbN0Db);

                    if (range != null && (best == null || range.Value > best.Value))
                    {
                        best = range;
                    }
                }
            }
            return best;
        }

        /// <summary>Fallback receiver noise temperature, matching <c>RealAntennasUplink</c>'s.</summary>
        private const double DefaultReceiverNoiseTempKelvin = 200.0;

        /// <summary>Fallback required Eb/N0, matching <c>RealAntennasUplink</c>'s.</summary>
        private const double DefaultRequiredEbN0Db = 2.5;
    }
}
