using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;

namespace Sitrep.Contract
{
    /// <summary>
    /// A map keyed by object identity that holds at most <see cref="Capacity"/>
    /// entries, forgetting the one read or written longest ago when a new key would
    /// pass that. A key forgotten this way reads as never seen. Any thread.
    /// </summary>
    internal sealed class IdentityRecencyMap<TKey, TValue>
        where TKey : class
    {
        /*
         * The alternative, a ConditionalWeakTable, is weak only where the collector
         * supports ephemerons. Unity's Mono runs Boehm, which does not, so every key
         * such a table was handed stayed alive for the rest of the session. A bound
         * by recency costs the same on every runtime.
         */
        private sealed class Slot
        {
            public TValue Value = default!;
            public long TouchedAt;
        }

        private readonly object _gate = new object();
        private readonly Dictionary<TKey, Slot> _slots = new Dictionary<TKey, Slot>(Identity.Instance);
        private long _clock;

        public IdentityRecencyMap(int capacity)
        {
            if (capacity < 1) throw new ArgumentOutOfRangeException(nameof(capacity));
            Capacity = capacity;
        }

        /// <summary>The most entries held at once.</summary>
        public int Capacity { get; }

        public int Count
        {
            get
            {
                lock (_gate)
                {
                    return _slots.Count;
                }
            }
        }

        /// <summary>The value held for <paramref name="key"/>, counting as a use of it.</summary>
        public bool TryGetValue(TKey key, out TValue value)
        {
            lock (_gate)
            {
                if (_slots.TryGetValue(key, out var slot))
                {
                    slot.TouchedAt = ++_clock;
                    value = slot.Value;
                    return true;
                }
                value = default!;
                return false;
            }
        }

        /// <summary>The value held for <paramref name="key"/>, or the one <paramref name="create"/> makes for it, held from now on.</summary>
        public TValue GetOrAdd(TKey key, Func<TKey, TValue> create)
        {
            lock (_gate)
            {
                if (!_slots.TryGetValue(key, out var slot))
                {
                    slot = Add(key, create(key));
                }
                slot.TouchedAt = ++_clock;
                return slot.Value;
            }
        }

        /// <summary>Holds <paramref name="value"/> for <paramref name="key"/>, replacing any earlier one.</summary>
        public void Set(TKey key, TValue value)
        {
            lock (_gate)
            {
                if (_slots.TryGetValue(key, out var slot))
                {
                    slot.Value = value;
                }
                else
                {
                    slot = Add(key, value);
                }
                slot.TouchedAt = ++_clock;
            }
        }

        public bool Remove(TKey key)
        {
            lock (_gate)
            {
                return _slots.Remove(key);
            }
        }

        private Slot Add(TKey key, TValue value)
        {
            if (_slots.Count >= Capacity)
            {
                ForgetOldest();
            }
            var slot = new Slot { Value = value };
            _slots[key] = slot;
            return slot;
        }

        private void ForgetOldest()
        {
            TKey? oldest = null;
            var oldestAt = long.MaxValue;
            foreach (var entry in _slots)
            {
                if (entry.Value.TouchedAt < oldestAt)
                {
                    oldest = entry.Key;
                    oldestAt = entry.Value.TouchedAt;
                }
            }
            if (oldest != null)
            {
                _slots.Remove(oldest);
            }
        }

        private sealed class Identity : IEqualityComparer<TKey>
        {
            public static readonly Identity Instance = new Identity();

            public bool Equals(TKey? x, TKey? y) => ReferenceEquals(x, y);

            public int GetHashCode(TKey obj) => RuntimeHelpers.GetHashCode(obj);
        }
    }
}
