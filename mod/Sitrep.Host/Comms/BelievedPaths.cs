using System;
using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The path each command centre was last worked out to believe in, for the
    /// passes between one plan and the next. A belief is of one craft's path:
    /// it answers for that craft and no other, so a centre asked about a
    /// craft that has since been put on screen in its place has none yet.
    /// Courier thread only.
    /// </summary>
    public sealed class BelievedPaths
    {
        private readonly Dictionary<string, (string Craft, CentrePathView View)> _believed =
            new Dictionary<string, (string, CentrePathView)>(StringComparer.Ordinal);

        /// <summary>Keeps what <paramref name="centre"/> believes of <paramref name="craft"/>'s path.</summary>
        public void Keep(string centre, string craft, CentrePathView view) => _believed[centre] = (craft, view);

        /// <summary>What <paramref name="centre"/> last believed of <paramref name="craft"/>'s path, or null when its last belief was of another craft or it has none.</summary>
        public CentrePathView? Of(string centre, string craft) =>
            _believed.TryGetValue(centre, out var held) && held.Craft == craft ? held.View : null;

        public void Forget(string centre) => _believed.Remove(centre);

        public void Clear() => _believed.Clear();
    }
}
