using System.Collections.Generic;
using CommNet;

namespace Gonogo.KSP
{
    /// <summary>
    /// One pass's map from a live <see cref="CommNode"/> to the vessel id that
    /// owns it, so naming a node costs one dictionary probe instead of a walk
    /// over every vessel in the game.
    ///
    /// <para>Naming a node is what lets a break be recorded against it
    /// (<c>INetwork.DropPath</c>), and the unindexed form of this is
    /// <c>ResolveOwningVessel</c>: a linear scan of <c>FlightGlobals.Vessels</c>
    /// comparing <c>vessel.connection.Comm</c> by reference. Asked once per node
    /// per tick that is O(nodes x vessels), which is why only the active vessel's
    /// route was ever named. One scan up front makes every name in the pass
    /// free.</para>
    ///
    /// <para>Deliberately a SNAPSHOT rather than a long-lived cache. A cache
    /// would have to be invalidated on every vessel appearing, being destroyed
    /// or being recycled, and getting that wrong hands out a stale id, which
    /// names a break against the wrong node, in a system whose whole failure
    /// rule is that a wrongly-declared break deletes telemetry that physically
    /// arrived. A snapshot also holds no reference to a destroyed node past the
    /// pass that built it. Rebuilding is one walk; being wrong is silent.</para>
    ///
    /// <para>Reference identity throughout: a <see cref="CommNode"/> is matched
    /// by being the same object, never by value, because two distinct nodes can
    /// compare equal on their fields and a vessel's node is identified by being
    /// the one its connection holds.</para>
    /// </summary>
    internal sealed class VesselNodeIndex
    {
        /// <summary>
        /// Reference identity, spelled out. <c>net472</c> has no built-in
        /// reference comparer, and the default one would defer to whatever
        /// <see cref="CommNode"/> does with equality.
        /// </summary>
        private sealed class ByReference : IEqualityComparer<CommNode>
        {
            internal static readonly ByReference Instance = new ByReference();

            public bool Equals(CommNode a, CommNode b) => ReferenceEquals(a, b);

            public int GetHashCode(CommNode node) =>
                System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(node);
        }

        private readonly Dictionary<CommNode, string> _byNode;

        private VesselNodeIndex(Dictionary<CommNode, string> byNode)
        {
            _byNode = byNode;
        }

        /// <summary>
        /// An index over nodes already paired with their owning vessel's id.
        /// The vessel walk in <see cref="From"/> is the only production caller;
        /// this exists so the identity rule can be exercised without a running
        /// game, and it deliberately builds through the SAME comparer, since a
        /// test supplying its own would be checking itself rather than this.
        /// </summary>
        internal static VesselNodeIndex ForNodes(params (CommNode Node, string Id)[] entries)
        {
            var byNode = NewMap();
            foreach (var entry in entries)
            {
                byNode[entry.Node] = entry.Id;
            }
            return new VesselNodeIndex(byNode);
        }

        private static Dictionary<CommNode, string> NewMap() =>
            new Dictionary<CommNode, string>(ByReference.Instance);

        /// <summary>How many nodes this pass could name. Zero is a legitimate answer.</summary>
        internal int Count => _byNode.Count;

        /// <summary>
        /// Walk <paramref name="vessels"/> once and index every vessel that has
        /// a comms node, by that node's reference.
        ///
        /// <para>Fail-soft on the shapes a torn-down or not-yet-started game
        /// produces: a null list, a null vessel, a vessel with no connection,
        /// and a connection with no node all contribute nothing rather than
        /// throwing. A vessel whose node is already indexed does not displace
        /// the first: two vessels reporting the SAME node object is not a state
        /// this can resolve, and keeping the first is at least stable within
        /// the pass.</para>
        /// </summary>
        internal static VesselNodeIndex From(IEnumerable<Vessel?>? vessels)
        {
            var byNode = NewMap();
            if (vessels == null)
            {
                return new VesselNodeIndex(byNode);
            }

            foreach (var vessel in vessels)
            {
                var node = vessel?.connection?.Comm;
                if (node == null)
                {
                    continue;
                }
                if (!byNode.ContainsKey(node))
                {
                    byNode[node] = vessel!.id.ToString();
                }
            }
            return new VesselNodeIndex(byNode);
        }

        /// <summary>
        /// The vessel id owning <paramref name="node"/>, or false when this pass
        /// saw no vessel holding it.
        ///
        /// <para>False is not an error: a ground station's node is owned by no
        /// vessel, and a caller names those some other way. It is deliberately
        /// not an empty string, so a caller cannot mistake "no owner" for a
        /// vessel whose id happens to be blank.</para>
        /// </summary>
        internal bool TryId(CommNode? node, out string id)
        {
            if (node != null && _byNode.TryGetValue(node, out var found))
            {
                id = found;
                return true;
            }
            id = "";
            return false;
        }
    }
}
