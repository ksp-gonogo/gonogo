using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;

namespace Gonogo.KSP
{
    /// <summary>
    /// A cache keyed by object identity whose entries go when their key is gone, by a
    /// test the owner supplies (for a Unity object, that it has been destroyed). Gone
    /// keys are swept whenever the cache has doubled since the last sweep, so it holds
    /// at most about twice the keys still alive. Any thread.
    /// </summary>
    internal sealed class PrunedCache<TKey, TValue>
        where TKey : class
    {
        /*
         * Unity's Mono runs the Boehm collector, which does not honour the weak half
         * of a ConditionalWeakTable: its keys are held strongly, so a table keyed by a
         * part's meshes kept every part ever measured. Holding keys strongly here and
         * sweeping them on an explicit test behaves the same on every runtime.
         */
        private const int FirstSweepAt = 64;

        private readonly Dictionary<TKey, TValue> _entries = new Dictionary<TKey, TValue>(IdentityComparer.Instance);
        private readonly object _gate = new object();
        private readonly Func<TKey, bool> _gone;
        private int _sweepAt = FirstSweepAt;

        /// <param name="gone">Whether a key is gone for good, so its entry can be dropped.</param>
        public PrunedCache(Func<TKey, bool> gone)
        {
            _gone = gone ?? throw new ArgumentNullException(nameof(gone));
        }

        /// <summary>How many entries are held, gone keys not yet swept included.</summary>
        public int Count
        {
            get
            {
                lock (_gate)
                {
                    return _entries.Count;
                }
            }
        }

        public bool TryGetValue(TKey key, out TValue value)
        {
            lock (_gate)
            {
                return _entries.TryGetValue(key, out value!);
            }
        }

        /// <summary>Stores <paramref name="value"/> for <paramref name="key"/>, replacing any earlier one.</summary>
        public void Set(TKey key, TValue value)
        {
            lock (_gate)
            {
                if (_entries.Count >= _sweepAt && !_entries.ContainsKey(key))
                {
                    Sweep();
                }
                _entries[key] = value;
            }
        }

        private void Sweep()
        {
            List<TKey>? gone = null;
            foreach (var key in _entries.Keys)
            {
                if (_gone(key))
                {
                    (gone ??= new List<TKey>()).Add(key);
                }
            }
            if (gone != null)
            {
                foreach (var key in gone)
                {
                    _entries.Remove(key);
                }
            }
            _sweepAt = Math.Max(FirstSweepAt, _entries.Count * 2);
        }

        private sealed class IdentityComparer : IEqualityComparer<TKey>
        {
            public static readonly IdentityComparer Instance = new IdentityComparer();

            public bool Equals(TKey? x, TKey? y) => ReferenceEquals(x, y);

            public int GetHashCode(TKey obj) => RuntimeHelpers.GetHashCode(obj);
        }
    }
}
