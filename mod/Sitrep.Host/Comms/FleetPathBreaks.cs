using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// One <see cref="PathBreakWatch"/> per fleet vessel, so a relay dropping
    /// out from under ANY craft's route home is raised against that craft, not
    /// only against the active one.
    ///
    /// <para>A watch retains the route it last saw to compare against, so one
    /// instance can follow exactly one subject: this keys them by vessel id.
    /// Everything that makes a single watch refuse (incomplete geometry, an
    /// unusable scale, a backend with no opinion, a tick spanning more UT than
    /// the route's light-time) still refuses here, because each vessel's
    /// answer comes from its own watch unchanged.</para>
    ///
    /// <para>The discriminator between a reroute and a destruction is the
    /// elected backend's router, asked whether the craft can still reach a node
    /// that left its route. <see cref="ICommsBackend.StillCarriesTo"/> cannot be
    /// used: it answers from the active vessel. The watch holds only ids, so the
    /// handles for the previous route's nodes are retained here, beside it,
    /// the same way <see cref="CommsBackendBase"/> retains them for the active
    /// vessel. A stale handle is safe for the same reason it is there: the
    /// router answers null for a node it no longer has, which is exactly what a
    /// destroyed relay should give.</para>
    ///
    /// <para>Three further refusals, each resolving to delivering: a hop whose
    /// far end cannot be named (two unnamed nodes would compare equal), a
    /// vessel with no connection to read, and UT running backwards, which is a
    /// quickload and puts the retained route on another timeline.</para>
    ///
    /// <para>Main-thread only, like the reads that feed it. Only the
    /// <see cref="PathBreak"/> it returns crosses to the Courier thread.</para>
    /// </summary>
    public sealed class FleetPathBreaks
    {
        private sealed class Subject
        {
            public readonly PathBreakWatch Watch = new PathBreakWatch();
            public Dictionary<string, object> Handles = new Dictionary<string, object>();
            public double Ut = double.NegativeInfinity;
        }

        private readonly Dictionary<string, Subject> _subjects = new Dictionary<string, Subject>();

        /// <summary>How many vessels have a retained route. Zero is a legitimate answer.</summary>
        public int Count => _subjects.Count;

        /// <summary>
        /// Compare <paramref name="route"/>, the vessel's control path home as
        /// measured hops, against what it was routing through last time, and
        /// return the break it reveals, or null.
        ///
        /// <para><paramref name="self"/> is the vessel's own node, the start of
        /// every question put to <paramref name="routeBetween"/>. A null
        /// <paramref name="route"/> means there was nothing to read; an EMPTY one
        /// is a craft with no route home, which is compared like any other.</para>
        /// </summary>
        public PathBreak? Observe(
            string vesselId,
            object? self,
            IReadOnlyList<CommsRouteHop>? route,
            Func<object?, string?> nameOf,
            double lightSpeedScale,
            double ut,
            Func<object?, object?, IReadOnlyList<CommsRouteHop>?>? routeBetween)
        {
            if (string.IsNullOrEmpty(vesselId) || self == null || route == null || nameOf == null)
            {
                _subjects.Remove(vesselId ?? "");
                return null;
            }

            var hops = new List<CommsHop>(route.Count);
            var handles = new Dictionary<string, object>();
            foreach (var hop in route)
            {
                var node = hop.ToHandle;
                var id = node != null ? nameOf(node) : null;
                if (node == null || id == null || id.Length == 0)
                {
                    _subjects.Remove(vesselId);
                    return null;
                }
                hops.Add(new CommsHop { To = id, DistanceMeters = hop.DistanceMeters });
                handles[id] = node;
            }

            if (!_subjects.TryGetValue(vesselId, out var subject) || ut < subject.Ut)
            {
                subject = new Subject();
                _subjects[vesselId] = subject;
            }

            var previous = subject.Handles;
            Func<string, bool?> carries = id =>
            {
                if (routeBetween == null || !previous.TryGetValue(id, out var node))
                {
                    return null;
                }
                if (ReferenceEquals(node, self))
                {
                    return true;
                }
                return routeBetween(self, node) != null;
            };

            var found = subject.Watch.Observe(
                new CommsPath { Hops = hops }, lightSpeedScale, ut, carries);
            subject.Handles = handles;
            subject.Ut = ut;
            return found;
        }

        /// <summary>
        /// Drop every vessel not in <paramref name="present"/>, so a craft that
        /// left the save takes its retained route and handles with it.
        /// </summary>
        public void Retain(ICollection<string> present)
        {
            if (_subjects.Count == 0)
            {
                return;
            }
            var gone = new List<string>();
            foreach (var id in _subjects.Keys)
            {
                if (!present.Contains(id))
                {
                    gone.Add(id);
                }
            }
            foreach (var id in gone)
            {
                _subjects.Remove(id);
            }
        }

        /// <summary>
        /// Forget every retained route, for the transitions where a comparison
        /// would be meaningless: delay switched off, or no backend to ask.
        /// </summary>
        public void Forget()
        {
            _subjects.Clear();
        }
    }
}
