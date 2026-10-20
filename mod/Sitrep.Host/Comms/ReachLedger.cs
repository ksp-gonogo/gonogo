using System;
using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What the last ledger pass found of who can reach whom: the subject nodes
    /// each command centre has no route to, and the craft whose route ends
    /// somewhere other than a ground station. Whether a copy can land on a craft,
    /// in either direction, is answered here by <see cref="CentreReach"/> and
    /// nowhere else, so a command and the word of who hears a craft cannot
    /// disagree about the same centre and craft. Courier-thread-only.
    /// </summary>
    internal sealed class ReachLedger
    {
        private Dictionary<string, HashSet<string>> _unroutable = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        private HashSet<string> _offTheGround = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>Replaces the whole set of nodes each centre has no route to, returning the set it replaced.</summary>
        public Dictionary<string, HashSet<string>> ReplaceUnroutable(Dictionary<string, HashSet<string>> next)
        {
            var previous = _unroutable;
            _unroutable = next;
            return previous;
        }

        /// <summary>Replaces the whole set of craft, by bare guid, whose route ends somewhere other than a ground station.</summary>
        public void ReplaceOffTheGround(IReadOnlyCollection<string> vesselIds) =>
            _offTheGround = new HashSet<string>(vesselIds, StringComparer.Ordinal);

        /// <summary>Whether <paramref name="centre"/>'s own route finding found no path to <paramref name="node"/>.</summary>
        public bool Unroutable(string centre, string node) =>
            _unroutable.TryGetValue(centre, out var nodes) && nodes.Contains(node);

        /// <summary>
        /// Whether a copy sent by <paramref name="centre"/> to <paramref name="node"/>,
        /// or by that node to the centre, lands. A craft's own fleet node follows
        /// <see cref="CentreReach"/>; any other node needs its link up and a route.
        /// </summary>
        /// <param name="centre">The centre as a vantage.</param>
        /// <param name="node">The subject node.</param>
        /// <param name="fleetPrefix">The prefix that marks a craft's own fleet node.</param>
        /// <param name="networkModelled">Whether the save models a comms network at all.</param>
        /// <param name="nodeConnected">Whether the node's own link is up.</param>
        /// <param name="homeCentre">The home centre's id, or null while there is none.</param>
        public bool Reaches(string centre, string node, string fleetPrefix, bool networkModelled, bool nodeConnected, string? homeCentre)
        {
            var unroutable = Unroutable(centre, node);
            if (node.StartsWith(fleetPrefix, StringComparison.Ordinal))
            {
                var vesselId = node.Substring(fleetPrefix.Length);
                return CentreReach.Reaches(centre, vesselId, networkModelled, nodeConnected, homeCentre, _offTheGround.Contains(vesselId), unroutable);
            }
            return nodeConnected && !unroutable;
        }
    }
}
