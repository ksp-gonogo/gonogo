using System;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Stock CommNet's declared reach rule: the model
    /// <see cref="CommNetBackend.ReachModel"/> hands back.
    ///
    /// <para>Stock gates a link on antenna power against a range curve, and it
    /// does so over up to THREE power pairings rather than one. Read off the
    /// shipped <c>Assembly-CSharp</c>, <c>CommNetwork.SetNodeConnection</c>
    /// requires each end to have some non-zero power at all, then asks
    /// <c>IRangeModel.InRange</c> three times: relay-to-relay, then, only if
    /// that failed, relay-to-transmit and transmit-to-relay. Any one of them
    /// clearing is a link. <c>TryConnect</c> then re-derives the same three
    /// pairings for signal strength, which is the second, independent
    /// corroboration that the set is those three and in those combinations.</para>
    ///
    /// <para><b>There is no transmit-to-transmit pairing, and its absence is a
    /// rule rather than an oversight.</b> Two nodes that can both only transmit
    /// never link at any distance, so such a pair's maximum reach is genuinely
    /// zero and not merely small. Dropping that guard would hand back the
    /// largest of three ranges for a pair stock refuses outright.</para>
    ///
    /// <para><b><c>distanceOffset</c> is charged against the maximum.</b> Stock
    /// adds both nodes' offsets to the separation BEFORE the range test
    /// (<c>num2 = sqrt(d^2) + a.distanceOffset + b.distanceOffset</c>), so a
    /// pair with offsets reaches that much less far in the separation a
    /// predictor measures. Subtracting them here keeps this model in the
    /// separation its consumer works in rather than in stock's adjusted
    /// one.</para>
    ///
    /// <para>Deliberately KSP-free, like <see cref="CommNetOcclusion"/>: the
    /// live reads (the two nodes' powers, the game's range model) stay in
    /// <see cref="CommNetBackend"/> on the capture-on-main seam, and the rule
    /// itself is exercised headlessly next to RealAntennas' declaration.</para>
    /// </summary>
    public static class CommNetReach
    {
        public const string ModelId = "commnet-range-curve";

        public const string ModelName = "Stock CommNet (antenna power vs range curve)";

        /// <summary>
        /// The model for one pair, given each end's two powers and the combined
        /// distance offset, plus the game's own range function.
        ///
        /// <para><paramref name="maximumRange"/> is
        /// <c>IRangeModel.GetMaximumRange</c>: the game's, not a
        /// re-derivation. Stock ships more than one range model and a career
        /// can be running either, so asking the live one is the difference
        /// between reporting the rule and reporting a guess at it.</para>
        ///
        /// <para>A pair stock would refuse outright, one end with no power at
        /// all or two transmit-only ends, yields a maximum of ZERO rather than
        /// an absent one: nothing reaches is an answer, and it must not be
        /// readable as "no rule declared".</para>
        /// </summary>
        public static ICommsReachModel Model(
            double fromRelayPower,
            double fromTransmitPower,
            double toRelayPower,
            double toTransmitPower,
            double combinedDistanceOffsetMeters,
            Func<double, double, double> maximumRange)
        {
            if (maximumRange == null)
            {
                return CommsReachModels.Unknown;
            }

            var fromHasAny = Positive(fromRelayPower) + Positive(fromTransmitPower) > 0.0;
            var toHasAny = Positive(toRelayPower) + Positive(toTransmitPower) > 0.0;
            if (!fromHasAny || !toHasAny)
            {
                return Nothing();
            }

            var best = double.NegativeInfinity;
            best = Better(best, Pairing(fromRelayPower, toRelayPower, maximumRange));
            best = Better(best, Pairing(fromRelayPower, toTransmitPower, maximumRange));
            best = Better(best, Pairing(fromTransmitPower, toRelayPower, maximumRange));

            if (double.IsNegativeInfinity(best))
            {
                // Every admissible pairing had a zero power on one side, which
                // is the transmit-to-transmit case: stock has no fourth pairing
                // to try, so nothing reaches.
                return Nothing();
            }

            var offset = Positive(combinedDistanceOffsetMeters);
            var reach = best - offset;
            return new MaxRangeReachModel(ModelId, ModelName, reach > 0.0 ? reach : 0.0);
        }

        /// <summary>
        /// A pair stock will not connect at any distance. Named rather than
        /// inlined because a zero maximum and an absent one are different
        /// answers and the difference is easy to lose.
        /// </summary>
        public static ICommsReachModel Nothing() => new MaxRangeReachModel(ModelId, ModelName, 0.0);

        /// <summary>
        /// One power pairing's maximum, or negative infinity when the pairing is
        /// not one stock would try. Both powers must be non-zero: stock's own
        /// guard is <c>relay + transmit != 0</c> per node, and a pairing that
        /// reaches for a zero power on either side is asking the range model
        /// about an antenna that is not there.
        /// </summary>
        private static double Pairing(double a, double b, Func<double, double, double> maximumRange)
        {
            if (!(a > 0.0) || !(b > 0.0))
            {
                return double.NegativeInfinity;
            }
            var range = maximumRange(a, b);
            return double.IsNaN(range) ? double.NegativeInfinity : range;
        }

        private static double Better(double best, double candidate) =>
            candidate > best ? candidate : best;

        private static double Positive(double value) =>
            double.IsNaN(value) || value < 0.0 ? 0.0 : value;
    }
}
