using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What the last ledger pass found of who can reach whom: the directions each
    /// command centre's route to a subject node carries, and the craft whose route
    /// ends somewhere other than a ground station. Whether a copy can land on a
    /// craft, and whether one can come back from it, is answered here by
    /// <see cref="CentreReach"/> and nowhere else, so a command and the word of who
    /// hears a craft cannot disagree about the same centre and craft.
    /// Courier-thread-only.
    /// </summary>
    internal sealed class ReachLedger
    {
        private Dictionary<string, Dictionary<string, CommsDirection>> _carried = new Dictionary<string, Dictionary<string, CommsDirection>>(StringComparer.Ordinal);
        private HashSet<string> _offTheGround = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Replaces the whole set of routes that do not carry both ways, returning the set it replaced.
        /// A centre or node not listed carries both.
        /// </summary>
        public Dictionary<string, Dictionary<string, CommsDirection>> ReplaceCarried(Dictionary<string, Dictionary<string, CommsDirection>> next)
        {
            var previous = _carried;
            _carried = next;
            return previous;
        }

        /// <summary>Replaces the whole set of craft, by bare guid, whose route ends somewhere other than a ground station.</summary>
        public void ReplaceOffTheGround(IReadOnlyCollection<string> vesselIds) =>
            _offTheGround = new HashSet<string>(vesselIds, StringComparer.Ordinal);

        /// <summary>
        /// The directions <paramref name="centre"/>'s own route finding found its route to <paramref name="node"/> carries,
        /// <see cref="CommsDirection.Forward"/> being a copy sent from the centre to the node.
        /// </summary>
        public CommsDirection Carried(string centre, string node) =>
            _carried.TryGetValue(centre, out var nodes) && nodes.TryGetValue(node, out var carried) ? carried : CommsDirection.Both;

        /// <summary>
        /// Whether a copy travelling the way <paramref name="direction"/> says, between
        /// <paramref name="centre"/> and <paramref name="node"/>, lands. A craft's own
        /// fleet node follows <see cref="CentreReach"/>; any other node needs its link
        /// up and a route that carries that way.
        /// </summary>
        /// <param name="centre">The centre as a vantage.</param>
        /// <param name="node">The subject node.</param>
        /// <param name="fleetPrefix">The prefix that marks a craft's own fleet node.</param>
        /// <param name="networkModelled">Whether the save models a comms network at all.</param>
        /// <param name="nodeConnected">Whether the node's own link is up.</param>
        /// <param name="homeCentre">The home centre's id, or null while there is none.</param>
        /// <param name="direction"><see cref="CommsDirection.Forward"/> for a copy sent from the centre to the node, <see cref="CommsDirection.Reverse"/> for one heard from it.</param>
        /// <param name="delayKnown">Whether any delay between the two is known. A pair with none is never reached, whatever else holds.</param>
        public bool Reaches(string centre, string node, string fleetPrefix, bool networkModelled, bool nodeConnected, string? homeCentre, CommsDirection direction, bool delayKnown = true)
        {
            if (!delayKnown)
            {
                return false;
            }
            var unroutable = !Carried(centre, node).HasFlag(direction);
            if (node.StartsWith(fleetPrefix, StringComparison.Ordinal))
            {
                var vesselId = node.Substring(fleetPrefix.Length);
                return CentreReach.Reaches(centre, vesselId, networkModelled, nodeConnected, homeCentre, _offTheGround.Contains(vesselId), unroutable);
            }
            return nodeConnected && !unroutable;
        }
    }
}
