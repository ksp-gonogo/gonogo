using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// A craft's link home as the delivery ledger and the roster read it for a
    /// craft the game is not simulating: a route solved afresh over the live
    /// graph to a home node, the same router the centre's plan is built from.
    /// Null is no reading, never a disconnection.
    ///
    /// <para>The craft's own cached state is not asked. The game refreshes it for a
    /// craft that is not loaded only when the craft is focused on a map, so it can
    /// read disconnected, with no path, for a craft the live graph reaches.</para>
    /// </summary>
    public static class FleetLinkReading
    {
        /// <summary>One solve: the reading, the home node reached, and the route to it.</summary>
        public readonly struct LinkSolve
        {
            public LinkSolve(bool? connected, CommsNodeHandle? home, IReadOnlyList<CommsRouteHop>? hops)
            {
                Connected = connected;
                Home = home;
                Hops = hops;
            }

            /// <summary>True when a home node was reached, false when the solve ran and none was, null when it could not be asked.</summary>
            public bool? Connected { get; }

            /// <summary>The home node the route reaches, when connected.</summary>
            public CommsNodeHandle? Home { get; }

            /// <summary>The route to <see cref="Home"/>, when connected.</summary>
            public IReadOnlyList<CommsRouteHop>? Hops { get; }
        }

        /// <summary>
        /// Solves a route to each of <paramref name="homes"/> in turn and stops at
        /// the first that routes. <paramref name="solve"/> returns null when the
        /// backend will not route between the two nodes, and a list, possibly
        /// empty, when it does. No home to solve to, or a solve that throws, is no
        /// reading. Main thread only, like every backend read.
        /// </summary>
        public static LinkSolve SolveUnloaded(IReadOnlyList<CommsNodeHandle>? homes, Func<CommsNodeHandle, IReadOnlyList<CommsRouteHop>?> solve)
        {
            if (homes == null || homes.Count == 0)
            {
                return new LinkSolve(null, null, null);
            }
            try
            {
                foreach (var home in homes)
                {
                    var hops = solve(home);
                    if (hops != null)
                    {
                        return new LinkSolve(true, home, hops);
                    }
                }
                return new LinkSolve(false, null, null);
            }
            catch (Exception)
            {
                return new LinkSolve(null, null, null);
            }
        }
    }

    /// <summary>
    /// Remembers each craft's last solve for a short window of game time, so a
    /// fleet of craft that are not loaded costs a bounded number of solves a
    /// second however many readers ask on a tick.
    /// </summary>
    public sealed class FleetLinkCache
    {
        private readonly double _windowSeconds;
        private readonly Dictionary<string, (double Ut, FleetLinkReading.LinkSolve Solve)> _last =
            new Dictionary<string, (double, FleetLinkReading.LinkSolve)>(StringComparer.Ordinal);

        public FleetLinkCache(double windowSeconds) => _windowSeconds = windowSeconds;

        /// <summary>The craft's last solve if it is younger than the window, otherwise a fresh one. A clock that went back is a new timeline: it never reuses a solve from later.</summary>
        public FleetLinkReading.LinkSolve Get(string craft, double ut, Func<FleetLinkReading.LinkSolve> solve)
        {
            if (_last.TryGetValue(craft, out var held) && ut >= held.Ut && ut - held.Ut < _windowSeconds)
            {
                return held.Solve;
            }
            var fresh = solve();
            _last[craft] = (ut, fresh);
            return fresh;
        }
    }
}
