using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Watches a subject's route home tick by tick and raises the DROP EVENT
    /// when a hop it was routing through stops carrying.
    ///
    /// <para>This is the half of the delay model that decides WHETHER a sample
    /// arrives. <see cref="SignalDelay"/> sums the same hop geometry into one
    /// scalar, which fixes when; the per-hop cumulative light-times it discards
    /// are what say where a break sat, and light already past that point is a
    /// wavefront on the far leg that the break is behind.</para>
    ///
    /// <para>A reroute and a destruction look IDENTICAL in the path: both are
    /// simply a different list of hops. The discriminator is
    /// <see cref="ICommsBackend.StillCarriesTo"/>, asked only of the hops that
    /// left the route, and only on the ticks the route changed. A hop that is
    /// still carrying is an ordinary reroute and the tail crossing it arrives,
    /// which is the behaviour <c>MiddlemanRerouteTests</c> pins.</para>
    ///
    /// <para>Refuses to answer rather than guessing, in four cases: incomplete
    /// hop geometry, an unusable light-speed scale, a backend with no opinion on
    /// whether a node still carries, and a tick that advanced UT by more than
    /// the whole route's light-time. A wrongly-declared break deletes telemetry
    /// that physically arrived, so every uncertainty resolves to today's
    /// behaviour, which is to deliver.</para>
    ///
    /// <para>Pure and main-thread: it holds node IDS and doubles, never a KSP
    /// handle, and the probe it is handed is what touches the live backend.
    /// Only its result crosses to the Courier thread.</para>
    /// </summary>
    public sealed class PathBreakWatch
    {
        /// <summary>One hop's far endpoint and its cumulative light-time from the subject.</summary>
        private readonly struct Rung
        {
            public Rung(string nodeId, double lightSecondsOut)
            {
                NodeId = nodeId;
                LightSecondsOut = lightSecondsOut;
            }

            public string NodeId { get; }

            public double LightSecondsOut { get; }
        }

        private List<Rung>? _ladder;
        private double _ladderUt;
        private double _ladderLightSeconds;

        /// <summary>
        /// Forget the retained route, so the next observation compares against
        /// nothing and raises nothing.
        ///
        /// <para>For the transitions where a comparison would be meaningless
        /// rather than merely uncertain: delay switched off, a different vessel
        /// becoming the subject, a quickload. Two routes belonging to different
        /// situations differ in every hop, and a diff over them would read as a
        /// break on the deepest one.</para>
        /// </summary>
        public void Forget()
        {
            _ladder = null;
        }

        /// <summary>
        /// Compare <paramref name="path"/> against the route retained from the
        /// last call and return the break it reveals, or null.
        ///
        /// <para><paramref name="stillCarries"/> is asked only about hops that
        /// have LEFT the route, and only its explicit <c>false</c> counts:
        /// <c>true</c> is an ordinary reroute and <c>null</c> is a backend
        /// declining to say, which is not evidence of a break.</para>
        ///
        /// <para>When several hops stopped carrying at once, the DEEPEST wins.
        /// Reaching a far break means crossing every nearer one first, so a
        /// sample survives exactly when it is past the furthest of them, and one
        /// drop at that position is the whole partition.</para>
        /// </summary>
        public PathBreak? Observe(
            CommsPath? path,
            double lightSpeedScale,
            double ut,
            System.Func<string, bool?> stillCarries)
        {
            var built = Build(path, lightSpeedScale);
            var previous = _ladder;
            var previousUt = _ladderUt;
            var previousLightSeconds = _ladderLightSeconds;

            if (built == null)
            {
                // Incomplete geometry or an unusable scale: SignalDelay reports
                // no measurable path for the same inputs, and a position derived
                // from a total it refuses to compute would be a fiction.
                _ladder = null;
                return null;
            }

            _ladder = built;
            _ladderUt = ut;
            _ladderLightSeconds = Total(built);

            if (previous == null || previous.Count == 0 || stillCarries == null)
            {
                return null;
            }

            /*
             * THE WARP DOMAIN, decided here and stated in the units that
             * actually bound it. Every quantity in this comparison shares one
             * quantum: the UT a tick advances by drives the death instant, the
             * ledger write and every scheduled delivery alike. So the question
             * "had this sample crossed the break when it opened" is answerable
             * only while that quantum is smaller than the flight it is being
             * asked about. Past that, sent, crossed and broke have no ordering
             * between them at all, and the honest behaviour is the one this
             * whole file exists to change: deliver, because we do not know it
             * did not cross.
             *
             * Expressed as tick-advance against the route's own light-time
             * rather than as a warp rate, because the rate at which it bites
             * depends on how far away the craft is. One rule covers a Kerbin
             * relay at 50x and Eeloo at 100000x.
             */
            var advance = ut - previousUt;
            if (previousLightSeconds <= 0.0 || advance > previousLightSeconds)
            {
                return null;
            }

            var surviving = new HashSet<string>();
            for (var i = 0; i < built.Count; i++)
            {
                surviving.Add(built[i].NodeId);
            }

            var deepest = double.NegativeInfinity;
            for (var i = 0; i < previous.Count; i++)
            {
                var rung = previous[i];
                if (surviving.Contains(rung.NodeId))
                {
                    continue;
                }
                if (stillCarries(rung.NodeId) != false)
                {
                    continue;
                }
                if (rung.LightSecondsOut > deepest)
                {
                    deepest = rung.LightSecondsOut;
                }
            }

            return deepest > double.NegativeInfinity
                ? new PathBreak(ut, deepest)
                : (PathBreak?)null;
        }

        /// <summary>
        /// The route as rungs, or null when its geometry cannot honestly be
        /// turned into light-times. An absent or empty path is a real answer
        /// (an empty ladder), not a refusal: it is what a craft with no route
        /// home looks like, and it is exactly the case that must still be
        /// compared against what it had a moment ago.
        /// </summary>
        private static List<Rung>? Build(CommsPath? path, double lightSpeedScale)
        {
            if (lightSpeedScale <= 0.0)
            {
                return null;
            }
            var effectiveC = SignalDelay.SpeedOfLightMetersPerSecond * lightSpeedScale;

            var rungs = new List<Rung>();
            var hops = path?.Hops;
            if (hops == null)
            {
                return rungs;
            }

            var metres = 0.0;
            foreach (var hop in hops)
            {
                if (hop == null || hop.DistanceMeters == null)
                {
                    return null;
                }
                metres += hop.DistanceMeters.Value;
                rungs.Add(new Rung(hop.To ?? "", metres / effectiveC));
            }
            return rungs;
        }

        private static double Total(List<Rung> ladder) =>
            ladder.Count == 0 ? 0.0 : ladder[ladder.Count - 1].LightSecondsOut;
    }
}
