using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Watches a subject's one-way light-time tick by tick and reports how fast
    /// it is changing, which is the half of the delay model that says where the
    /// value is GOING.
    ///
    /// <para><see cref="SignalDelay.Compute"/> answers for one instant, and one
    /// instant is all a consumer's forward model is handed: it holds the point
    /// and no history, so a rate it is not given is a rate it cannot difference
    /// out for itself. Publishing one is what makes <c>comms.delay</c> carriable
    /// at all.</para>
    ///
    /// <para><b>Why here rather than in the consumer.</b> Differencing a bare
    /// scalar cannot tell motion from a REROUTE. The route changes hop for hop
    /// and the total jumps, and the jump over the interval is a rate of nothing:
    /// integrate it and the delay runs away. This holds the ordered hop list the
    /// total was summed from, so it can ask whether the route is even the same
    /// one, and it observes every physics tick rather than at whatever rate the
    /// channel is sampled at or a relayed station receives it.</para>
    ///
    /// <para>Refuses rather than guessing, and every refusal is a null: the
    /// first observation of a route, the tick a reroute lands on, a clock that
    /// did not advance or that rewound, and any tick with no measurable delay at
    /// either end. A wrong rate is worse than no rate, because a consumer
    /// integrates it and a missing one only leaves the value where it was.</para>
    ///
    /// <para>Pure and main-thread, exactly as <see cref="PathBreakWatch"/> is: it
    /// retains node ids and doubles, never a KSP handle, and only the resulting
    /// scalar crosses to the Courier thread.</para>
    /// </summary>
    public sealed class SignalDelayRate
    {
        private List<string>? _route;
        private CommsDelaySource _source;
        private double _seconds;
        private double _ut;

        /// <summary>
        /// Forget the retained observation, so the next one compares against
        /// nothing and reports no rate.
        ///
        /// <para>For the transitions where a comparison would be meaningless
        /// rather than merely uncertain: delay switched off, a different vessel
        /// becoming the subject, a quickload. The route check below catches a
        /// reroute; it cannot catch two routes that happen to run through the
        /// same nodes in two unrelated situations.</para>
        /// </summary>
        public void Forget()
        {
            _route = null;
        }

        /// <summary>
        /// Take one observation of <paramref name="oneWaySeconds"/> over
        /// <paramref name="path"/> at <paramref name="ut"/>, and return the rate
        /// it reveals against the one retained from the last call, or null.
        ///
        /// <para>Takes the delay as ALREADY COMPUTED rather than re-summing the
        /// hops, so this adds no fourth place where a route becomes a
        /// light-time. The path is read only for its node ids, to decide whether
        /// the two observations are of the same route.</para>
        ///
        /// <para><paramref name="source"/> is compared alongside the route,
        /// because a change of REGIME moves the total without the geometry
        /// moving at all. Switching the delay feature on takes it from an
        /// applied zero to a real light-time between one tick and the next over
        /// an unchanged set of hops, and so does a simulation ending; a rate
        /// differenced across either would be enormous and about nothing.</para>
        /// </summary>
        public double? Observe(
            CommsPath? path,
            double? oneWaySeconds,
            CommsDelaySource source,
            double ut)
        {
            var route = RouteOf(path);
            var previousRoute = _route;
            var previousSource = _source;
            var previousSeconds = _seconds;
            var previousUt = _ut;

            if (oneWaySeconds == null || double.IsNaN(ut) || double.IsInfinity(ut))
            {
                // Nothing measurable to retain, and retaining the last thing
                // that was would make the next tick difference across the gap.
                _route = null;
                return null;
            }

            _route = route;
            _source = source;
            _seconds = oneWaySeconds.Value;
            _ut = ut;

            if (previousRoute == null
                || previousSource != source
                || !SameRoute(previousRoute, route))
            {
                return null;
            }

            var advance = ut - previousUt;
            if (!(advance > 0.0))
            {
                // A tick that did not advance divides by zero; one that went
                // backwards is a quickload, and the delay either side of it
                // belongs to two different histories.
                return null;
            }

            return (oneWaySeconds.Value - previousSeconds) / advance;
        }

        /// <summary>
        /// The route as the ordered node ids it runs through. An absent or empty
        /// path is a real answer (an empty route), not a refusal: a craft with no
        /// way home has a delay of null and is turned away above, and this keeps
        /// the two spellings of "no hops" comparing equal rather than reading as
        /// a reroute.
        /// </summary>
        private static List<string> RouteOf(CommsPath? path)
        {
            var ids = new List<string>();
            var hops = path?.Hops;
            if (hops == null)
            {
                return ids;
            }
            foreach (var hop in hops)
            {
                ids.Add(hop == null ? "" : (hop.From ?? "") + "\u001f" + (hop.To ?? ""));
            }
            return ids;
        }

        private static bool SameRoute(List<string> a, List<string> b)
        {
            if (a.Count != b.Count)
            {
                return false;
            }
            for (var i = 0; i < a.Count; i++)
            {
                if (!string.Equals(a[i], b[i], System.StringComparison.Ordinal))
                {
                    return false;
                }
            }
            return true;
        }
    }
}
