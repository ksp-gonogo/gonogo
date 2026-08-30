using System.Collections;
using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// Value-equality over the dictionary/list/scalar trees every
    /// <c>*ViewProvider</c> mapper hands back, for
    /// <see cref="ChannelEmitter"/>'s change-gate.
    ///
    /// <para><b>Why this exists.</b> A mapper builds a fresh
    /// <c>Dictionary&lt;string, object?&gt;</c> on every call, and
    /// <c>Dictionary</c> does not override <c>Equals</c>, so the gate's
    /// <c>!Equals(lastEmitted, value)</c> fallback was REFERENCE equality and
    /// answered "changed" for every structured payload ever considered. The
    /// gate worked for scalars and was inert for the rest. Measured against
    /// the deck's RO 200 km capture, <c>system.bodies</c> alone was 82% of the
    /// stream's bytes at 1 Hz while its content never moved once.</para>
    ///
    /// <para><b>Leaves compare exactly</b>, never through
    /// <see cref="Sitrep.Contract.EmissionQuantum"/>. A quantum is a
    /// single-channel scalar deadband, and a tree's leaves are heterogeneous:
    /// an absolute 5 m altitude deadband applied to an eccentricity would
    /// suppress a real change. Every structured channel declares
    /// <c>Absolute(0)</c> anyway.</para>
    ///
    /// <para><b>What a producer owes this.</b> A payload must be built fresh,
    /// or at least never mutated after it is handed over. A producer that keeps
    /// a nested list or dictionary alive across ticks and edits it in place
    /// hands the gate the SAME object as both sides of the comparison, and it
    /// will correctly report that an object equals itself while the value it
    /// described has moved. Nothing in the tree does this (every mapper and
    /// every publisher allocates), and the previous reference comparison had
    /// the same hazard one level up, so this is a rule to keep rather than one
    /// to introduce.</para>
    ///
    /// <para><b>Every uncertain answer is "changed".</b> An unrecognised shape
    /// falls through to its own <c>Equals</c> (the pre-existing behaviour), and
    /// a tree that overruns the node budget or the depth cap answers "changed"
    /// rather than guessing. Emitting a payload that had not moved costs
    /// bandwidth; suppressing one that had moved loses data until the next
    /// keyframe, so the failure directions are not symmetric and the cheap one
    /// is the default.</para>
    /// </summary>
    public static class StructuralEquality
    {
        /*
         * Bounds, not tuning. Payload trees are acyclic by construction (built
         * fresh from a snapshot each call), but the mappers are uplink-authored
         * and a cycle would otherwise recurse until the stack gave out, which
         * is not a catchable failure. The node budget terminates a cycle and
         * the depth cap keeps recursion inside the stack while it does. Both
         * are far above any real payload: the largest measured tree,
         * system.bodies under RSS with atmosphere pressure profiles, is ~1,400
         * nodes at depth 4.
         */
        private const int MaxNodes = 100_000;
        private const int MaxDepth = 64;

        /// <summary>
        /// True when <paramref name="a"/> and <paramref name="b"/> describe the
        /// same value. Reference-equal is equal; beyond that, dictionaries
        /// compare by key (order-independent), sequences compare in order, and
        /// anything else compares with its own <c>Equals</c>.
        /// </summary>
        public static bool Equal(object? a, object? b)
        {
            var budget = MaxNodes;
            return Equal(a, b, 0, ref budget);
        }

        private static bool Equal(object? a, object? b, int depth, ref int budget)
        {
            if (ReferenceEquals(a, b))
            {
                return true;
            }
            if (a == null || b == null)
            {
                return false;
            }
            if (--budget < 0 || depth > MaxDepth)
            {
                return false;
            }

            // A string is an IEnumerable of chars; compare it as the scalar it is.
            if (a is string || b is string)
            {
                return a.Equals(b);
            }

            /*
             * The typed fast paths cover every shape the bundled mappers
             * actually build. They matter because foreach over the non-generic
             * IDictionary / IEnumerable interfaces boxes an enumerator per node,
             * and this runs on the tick path; the concrete types' enumerators
             * are structs and allocate nothing.
             */
            if (a is Dictionary<string, object?> fastA && b is Dictionary<string, object?> fastB)
            {
                if (fastA.Count != fastB.Count)
                {
                    return false;
                }
                foreach (var entry in fastA)
                {
                    if (!fastB.TryGetValue(entry.Key, out var other) || !Equal(entry.Value, other, depth + 1, ref budget))
                    {
                        return false;
                    }
                }
                return true;
            }

            if (a is List<object?> listA && b is List<object?> listB)
            {
                if (listA.Count != listB.Count)
                {
                    return false;
                }
                for (var i = 0; i < listA.Count; i++)
                {
                    if (!Equal(listA[i], listB[i], depth + 1, ref budget))
                    {
                        return false;
                    }
                }
                return true;
            }

            if (a is double[] doublesA && b is double[] doublesB)
            {
                if (doublesA.Length != doublesB.Length)
                {
                    return false;
                }
                for (var i = 0; i < doublesA.Length; i++)
                {
                    // Bit-equality, so a NaN in a pressure profile reads as
                    // unchanged against the NaN that was emitted last time
                    // rather than re-emitting the whole profile forever.
                    if (!doublesA[i].Equals(doublesB[i]))
                    {
                        return false;
                    }
                }
                return true;
            }

            if (a is IDictionary mapA && b is IDictionary mapB)
            {
                if (mapA.Count != mapB.Count)
                {
                    return false;
                }
                foreach (DictionaryEntry entry in mapA)
                {
                    if (!mapB.Contains(entry.Key) || !Equal(entry.Value, mapB[entry.Key], depth + 1, ref budget))
                    {
                        return false;
                    }
                }
                return true;
            }

            if (a is IEnumerable seqA && b is IEnumerable seqB)
            {
                return SequenceEqual(seqA, seqB, depth, ref budget);
            }

            return a.Equals(b);
        }

        private static bool SequenceEqual(IEnumerable a, IEnumerable b, int depth, ref int budget)
        {
            var left = a.GetEnumerator();
            var right = b.GetEnumerator();
            try
            {
                while (true)
                {
                    var hasLeft = left.MoveNext();
                    var hasRight = right.MoveNext();
                    if (hasLeft != hasRight)
                    {
                        return false;
                    }
                    if (!hasLeft)
                    {
                        return true;
                    }
                    if (!Equal(left.Current, right.Current, depth + 1, ref budget))
                    {
                        return false;
                    }
                }
            }
            finally
            {
                (left as System.IDisposable)?.Dispose();
                (right as System.IDisposable)?.Dispose();
            }
        }
    }
}
