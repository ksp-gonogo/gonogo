using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The route the active craft's samples were taking when the newest of them
    /// to reach each command centre was sent: the game's route as that centre
    /// has learned it.
    ///
    /// <para>A centre learns which route the craft's signal takes from the
    /// signal itself, so a route the game took at UT <c>t</c> reaches the centre
    /// at <c>t</c> plus that route's own signal delay, the same time the first
    /// sample sent over it arrives. A relay destroyed far from the centre, or a
    /// reroute, is not known there any sooner. When the game has no route, the
    /// craft's last samples are still arriving over the one it had, so the loss
    /// reaches the centre when the last of them does.</para>
    ///
    /// <para>Bounded by one signal delay of looks per centre: once a route has
    /// reached a centre, everything taken before it is dropped.
    /// Courier-thread-only.</para>
    /// </summary>
    internal sealed class ReceivedRoutes
    {
        private readonly struct Taken
        {
            public Taken(double revealUt, IReadOnlyList<CommsHop>? route)
            {
                RevealUt = revealUt;
                Route = route;
            }

            public double RevealUt { get; }

            public IReadOnlyList<CommsHop>? Route { get; }
        }

        private sealed class Centre
        {
            public string? Craft;
            public readonly List<Taken> Taken = new List<Taken>();
            public IReadOnlyList<CommsHop>? Latest;
            public double LatestSeconds;
        }

        private readonly Dictionary<string, Centre> _centres = new Dictionary<string, Centre>(StringComparer.Ordinal);

        /// <summary>
        /// Notes the route the game has from <paramref name="craft"/> to
        /// <paramref name="centre"/> at <paramref name="ut"/>, or null for none,
        /// and returns the route that has reached the centre by then, or null
        /// when none has.
        /// </summary>
        /// <param name="lightFactor">What a real signal delay is multiplied by, or zero or less where no delay is applied: see <see cref="DeliveryInputs.LightFactor"/>.</param>
        public IReadOnlyList<CommsHop>? Note(string centre, string craft, double ut, IReadOnlyList<CommsHop>? route, double lightFactor)
        {
            if (!_centres.TryGetValue(centre, out var held))
            {
                held = new Centre();
                _centres[centre] = held;
            }
            if (held.Craft != craft)
            {
                // Another craft's route says nothing of this one's.
                held.Craft = craft;
                held.Taken.Clear();
                held.Latest = null;
                held.LatestSeconds = 0.0;
            }

            // Every look, not every change: the hops lengthen and shorten as the craft moves, and the centre is owed the lengths its samples were sent over.
            var seconds = route == null ? held.LatestSeconds : SecondsOver(route, lightFactor, held.LatestSeconds);
            held.LatestSeconds = seconds;
            held.Taken.Add(new Taken(ut + seconds, route));

            var reached = -1;
            for (var i = 0; i < held.Taken.Count; i++)
            {
                if (held.Taken[i].RevealUt <= ut)
                {
                    reached = i;
                }
            }
            if (reached >= 0)
            {
                held.Latest = held.Taken[reached].Route;
                held.Taken.RemoveRange(0, reached);
            }
            return held.Latest;
        }

        /// <summary>Forgets every route, for a timeline the routes were not taken on.</summary>
        public void Clear() => _centres.Clear();

        /// <summary>
        /// The signal delay of <paramref name="route"/>, or
        /// <paramref name="fallback"/> where its geometry is incomplete. Zero
        /// where no delay is applied.
        /// </summary>
        private static double SecondsOver(IReadOnlyList<CommsHop> route, double lightFactor, double fallback)
        {
            if (!(lightFactor > 0.0))
            {
                return 0.0;
            }
            var seconds = CentreDelay.Over(new CommsPath { Hops = new List<CommsHop>(route) }, lightFactor, "").OneWaySeconds;
            return seconds ?? fallback;
        }
    }
}
