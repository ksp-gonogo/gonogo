using System;
using System.Collections.Generic;

namespace Sitrep.Core.StoreAndForward
{
    /// <summary>
    /// The sending command centre's half of a lane: the next lane number, and
    /// every earlier number it has not yet seen resolved, with the latest instant
    /// a copy of it could still arrive.
    ///
    /// <para>A number is resolved when its reply, or a report that it was
    /// cancelled or expired, reaches the sender, or when its expiry has passed,
    /// after which no copy of it can still arrive anywhere.</para>
    /// </summary>
    public sealed class LaneSender
    {
        private readonly SortedDictionary<long, double> _unresolved = new SortedDictionary<long, double>();

        /// <summary>The number the next command will take.</summary>
        public long NextSeq { get; private set; } = 1;

        /// <summary>The newest number assigned so far, or 0 before any.</summary>
        public long NewestSeq => NextSeq - 1;

        /// <summary>
        /// Takes the next lane number for a command expiring at
        /// <paramref name="expiresUt"/>, and the gap expiry it carries: the latest
        /// expiry of any earlier number still unresolved at <paramref name="nowUt"/>,
        /// or null when every earlier number is provably settled.
        /// </summary>
        public (long Seq, double? GapExpiresUt) Assign(double nowUt, double expiresUt)
        {
            Forget(nowUt);
            double? gap = null;
            foreach (var expiry in _unresolved.Values)
            {
                gap = gap == null ? expiry : Math.Max(gap.Value, expiry);
            }
            var seq = NextSeq++;
            _unresolved[seq] = expiresUt;
            return (seq, gap);
        }

        /// <summary>The gap expiry a new copy of <paramref name="seq"/> would carry: the latest expiry of any earlier unresolved number.</summary>
        public double? GapBefore(long seq, double nowUt)
        {
            Forget(nowUt);
            double? gap = null;
            foreach (var entry in _unresolved)
            {
                if (entry.Key >= seq)
                {
                    break;
                }
                gap = gap == null ? entry.Value : Math.Max(gap.Value, entry.Value);
            }
            return gap;
        }

        /// <summary>Records a further copy of <paramref name="seq"/> that could arrive as late as <paramref name="expiresUt"/>.</summary>
        public void AddCopy(long seq, double expiresUt)
        {
            if (_unresolved.TryGetValue(seq, out var existing))
            {
                _unresolved[seq] = Math.Max(existing, expiresUt);
                return;
            }
            if (seq < NextSeq)
            {
                _unresolved[seq] = expiresUt;
            }
        }

        /// <summary>Records that <paramref name="seq"/> has settled: replied to, cancelled or expired, as reported.</summary>
        public void Resolve(long seq) => _unresolved.Remove(seq);

        /// <summary>Whether <paramref name="seq"/> is still unresolved.</summary>
        public bool IsUnresolved(long seq) => _unresolved.ContainsKey(seq);

        /// <summary>The unresolved numbers and their latest expiries, for saving with the game.</summary>
        public IReadOnlyDictionary<long, double> Unresolved => _unresolved;

        /// <summary>Restores a lane from a save.</summary>
        public static LaneSender Restore(long nextSeq, IEnumerable<KeyValuePair<long, double>> unresolved)
        {
            var lane = new LaneSender { NextSeq = Math.Max(1, nextSeq) };
            foreach (var entry in unresolved)
            {
                lane._unresolved[entry.Key] = entry.Value;
            }
            return lane;
        }

        /// <summary>Drops numbers whose last possible arrival has passed: nothing of them can still arrive.</summary>
        private void Forget(double nowUt)
        {
            List<long>? dead = null;
            foreach (var entry in _unresolved)
            {
                if (entry.Value < nowUt)
                {
                    (dead ??= new List<long>()).Add(entry.Key);
                }
            }
            if (dead == null)
            {
                return;
            }
            foreach (var seq in dead)
            {
                _unresolved.Remove(seq);
            }
        }
    }
}
