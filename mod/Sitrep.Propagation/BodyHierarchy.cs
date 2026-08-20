using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Propagation
{
    /// <summary>
    /// The shape of the body tree between two points in it: climb from one to the
    /// common ancestor, then descend to the other.
    ///
    /// <para>Topology only. It says which bodies lie on the path and in what order,
    /// and says nothing about whether their elements can be solved or how big they
    /// are to a radio wave, because its two callers want different answers to both.
    /// <see cref="KeplerProvider"/> walks the path summing conics and so needs every
    /// link to be a bound one; the visibility side walks the same path to pick
    /// occluders and does not care what any of them orbits on.</para>
    ///
    /// <para>Shared rather than written twice for the obvious reason: two walks over
    /// the same parent pointers are free to disagree about the shape of the
    /// hierarchy, and a disagreement there is a position error of whole planetary
    /// radii that still looks like a plausible number.</para>
    /// </summary>
    public static class BodyHierarchy
    {
        /// <summary>
        /// <paramref name="index"/> and every body above it, nearest first, root
        /// last. Null when the index is out of range or the parent pointers loop,
        /// which a malformed table can do and which must not hang a sweep.
        /// </summary>
        public static List<int>? AncestorsOf(int index, IReadOnlyList<SystemBody>? bodies)
        {
            if (bodies == null || index < 0 || index >= bodies.Count)
            {
                return null;
            }

            var chain = new List<int>();
            var walker = index;
            var guard = bodies.Count + 1;
            while (walker >= 0 && guard-- > 0)
            {
                if (walker >= bodies.Count)
                {
                    return null;
                }
                chain.Add(walker);
                walker = bodies[walker].ParentIndex;
            }
            return guard > 0 ? chain : null;
        }

        /// <summary>
        /// The path from <paramref name="fromIndex"/> to <paramref name="toIndex"/>,
        /// split at their common ancestor.
        ///
        /// <para><paramref name="climb"/> is the bodies strictly below the ancestor
        /// on the FROM branch, nearest <paramref name="fromIndex"/> first. Walking
        /// past one of these SUBTRACTS its own orbit, because the frame sits on the
        /// far side of it. <paramref name="descend"/> is the bodies strictly below
        /// the ancestor on the TO branch, nearest the ancestor first, each of which
        /// ADDS its own orbit.</para>
        ///
        /// <para>Both lists empty means the two are the same body. False means there
        /// is no path at all: different systems, or a malformed hierarchy.</para>
        /// </summary>
        public static bool TryPathBetween(
            int fromIndex,
            int toIndex,
            IReadOnlyList<SystemBody>? bodies,
            out List<int> climb,
            out List<int> descend)
        {
            climb = new List<int>();
            descend = new List<int>();

            if (bodies == null
                || fromIndex < 0 || fromIndex >= bodies.Count
                || toIndex < 0 || toIndex >= bodies.Count)
            {
                return false;
            }
            if (fromIndex == toIndex)
            {
                return true;
            }

            var fromBranch = AncestorsOf(fromIndex, bodies);
            var toBranch = AncestorsOf(toIndex, bodies);
            if (fromBranch == null || toBranch == null)
            {
                return false;
            }

            var ancestor = -1;
            var meetAt = -1;
            for (var i = 0; i < fromBranch.Count && ancestor < 0; i++)
            {
                if (toBranch.Contains(fromBranch[i]))
                {
                    ancestor = fromBranch[i];
                    meetAt = i;
                }
            }
            if (ancestor < 0)
            {
                return false;
            }

            for (var i = 0; i < meetAt; i++)
            {
                climb.Add(fromBranch[i]);
            }

            for (var i = 0; i < toBranch.Count && toBranch[i] != ancestor; i++)
            {
                descend.Add(toBranch[i]);
            }
            descend.Reverse();

            return true;
        }
    }
}
