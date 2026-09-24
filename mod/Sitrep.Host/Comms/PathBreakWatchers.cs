using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Every watched craft's route home at once: one <see cref="PathBreakWatch"/>
    /// per craft, each comparing that craft's route against its own last one.
    ///
    /// <para>A craft is keyed by its own stable id, never by which engine node
    /// it currently speaks through, so a vessel that becomes the one on screen
    /// keeps the route history it already had instead of starting a comparison
    /// against the previous craft's.</para>
    ///
    /// <para>A craft can speak through more than one engine node over one
    /// physical route (the craft on screen publishes on its own node and on its
    /// fleet node), so a break is placed on every node it names: a relay dying
    /// under it catches whatever that route was carrying, whichever topic it was
    /// sent on.</para>
    ///
    /// <para>A craft absent from an observation is forgotten, so one that comes
    /// back is compared against nothing and raises nothing, the same rule
    /// <see cref="PathBreakWatch.Forget"/> applies to a single route.</para>
    /// </summary>
    public sealed class PathBreakWatchers
    {
        /// <summary>One craft to watch this tick: its route, and how to ask about a hop that left it.</summary>
        public readonly struct Subject
        {
            public Subject(string key, IReadOnlyList<string> nodes, CommsPath? path, Func<string, bool?> stillCarries)
            {
                Key = key ?? "";
                Nodes = nodes ?? Array.Empty<string>();
                Path = path;
                StillCarries = stillCarries;
            }

            /// <summary>The craft's own stable id.</summary>
            public string Key { get; }

            /// <summary>Every engine node the craft's samples are sent from. A break is placed on each.</summary>
            public IReadOnlyList<string> Nodes { get; }

            /// <summary>The craft's route home this tick.</summary>
            public CommsPath? Path { get; }

            /// <summary>Whether a hop that left this craft's route still carries from it.</summary>
            public Func<string, bool?> StillCarries { get; }
        }

        private readonly Dictionary<string, PathBreakWatch> _watches =
            new Dictionary<string, PathBreakWatch>(StringComparer.Ordinal);

        /// <summary>
        /// Compare each subject's route against its own last one and return every
        /// break revealed, or null when none was.
        /// </summary>
        public IReadOnlyList<PathBreak>? Observe(IEnumerable<Subject> subjects, double lightSpeedScale, double ut)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            List<PathBreak>? breaks = null;
            foreach (var subject in subjects)
            {
                if (subject.Key.Length == 0 || subject.Nodes.Count == 0 || !seen.Add(subject.Key))
                {
                    continue;
                }
                if (!_watches.TryGetValue(subject.Key, out var watch))
                {
                    watch = new PathBreakWatch();
                    _watches[subject.Key] = watch;
                }
                var found = watch.Observe(subject.Nodes[0], subject.Path, lightSpeedScale, ut, subject.StillCarries);
                if (found == null)
                {
                    continue;
                }
                breaks ??= new List<PathBreak>();
                foreach (var node in subject.Nodes)
                {
                    breaks.Add(new PathBreak(node, found.Value.AtUt, found.Value.LightSecondsOut));
                }
            }

            if (_watches.Count > seen.Count)
            {
                var gone = new List<string>();
                foreach (var key in _watches.Keys)
                {
                    if (!seen.Contains(key))
                    {
                        gone.Add(key);
                    }
                }
                foreach (var key in gone)
                {
                    _watches.Remove(key);
                }
            }
            return breaks;
        }

        /// <summary>Forget every craft's route, for the transitions where no comparison means anything.</summary>
        public void Forget() => _watches.Clear();
    }
}
