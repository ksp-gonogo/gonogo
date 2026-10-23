using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Results kept per key for as long as the key's stamp (a file's write time)
    /// is unchanged, so a file is read again only after it changes. Main thread only.
    /// </summary>
    internal sealed class StampedCache<T>
    {
        private readonly Dictionary<string, KeyValuePair<long, T>> _entries = new Dictionary<string, KeyValuePair<long, T>>(StringComparer.Ordinal);
        private readonly HashSet<string> _seen = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>The kept result for <paramref name="key"/> when it was stored under <paramref name="stamp"/>.</summary>
        public bool TryGet(string key, long stamp, out T value)
        {
            _seen.Add(key);
            if (_entries.TryGetValue(key, out var entry) && entry.Key == stamp)
            {
                value = entry.Value;
                return true;
            }

            value = default!;
            return false;
        }

        public void Put(string key, long stamp, T value)
        {
            _seen.Add(key);
            _entries[key] = new KeyValuePair<long, T>(stamp, value);
        }

        /// <summary>Forgets every key not asked for since the last call, so a deleted file stops being held.</summary>
        public void ForgetUnseen()
        {
            foreach (var key in new List<string>(_entries.Keys))
            {
                if (!_seen.Contains(key))
                {
                    _entries.Remove(key);
                }
            }

            _seen.Clear();
        }
    }
}
