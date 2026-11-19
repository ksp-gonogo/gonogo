using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// The windows a client has just subscribed to, read ahead of the sweep in two steps. The first step of a
    /// window is silent, and a caller need not walk the part for it: another mod may switch a part module on only once it has seen the subscription (a
    /// part's name tag module), so that read would publish a window without it and the client, which is first sent the
    /// window it last had, would see the group vanish and come back. The same window is read again at the
    /// next sample, and that read is the one published. Each id is read once in each step, and an id queued
    /// twice is read once. Thread-safe: ids are added from the Courier thread and taken on the main thread.
    /// </summary>
    public sealed class PartWindowFresh
    {
        private readonly object _lock = new object();
        private readonly Queue<string> _first = new Queue<string>();
        private readonly HashSet<string> _firstQueued = new HashSet<string>();
        private readonly Queue<string> _settle = new Queue<string>();
        private readonly HashSet<string> _settleQueued = new HashSet<string>();
        private readonly Dictionary<string, int> _misses = new Dictionary<string, int>();

        /// <summary>Queues a window for its first read.</summary>
        public void Add(string id)
        {
            lock (_lock)
            {
                if (_firstQueued.Add(id))
                {
                    _first.Enqueue(id);
                }
            }
        }

        /// <summary>
        /// True when the window is queued for a first or a second read. The sweep leaves such a window to this
        /// queue: a sweep read in the sample of the first read would publish the window before the other mod
        /// has switched its modules on, the frame this queue exists to hold back.
        /// </summary>
        public bool IsPending(string id)
        {
            lock (_lock)
            {
                return _firstQueued.Contains(id) || _settleQueued.Contains(id);
            }
        }

        /// <summary>True when any window waits for a read.</summary>
        public bool Pending
        {
            get
            {
                lock (_lock)
                {
                    return _first.Count > 0 || _settle.Count > 0;
                }
            }
        }

        /// <summary>
        /// The reads this sample should make, until <paramref name="elapsedMs"/> passes <paramref name="budgetMs"/>
        /// (checked after each read, so one is always made when any waits): the second reads of windows read at
        /// an earlier sample, to publish, then first reads, not to publish. A window read for the first time here
        /// is second-read at the next call. A first read waits until <paramref name="ready"/> answers true for
        /// the window, that is until the host's subscription mirror holds it: another mod that switches a module
        /// on for a watched window reads that same mirror in the same sample, so a window is only read once the
        /// mod has seen it too. A window not ready in 30 calls is dropped.
        /// </summary>
        public List<(string Id, bool Publish)> Take(Func<long> elapsedMs, long budgetMs, Func<string, bool> ready)
        {
            var reads = new List<(string Id, bool Publish)>();
            var firstReads = new List<string>();
            var notReady = new List<string>();
            lock (_lock)
            {
                var settleNow = _settle.Count;
                for (var i = 0; i < settleNow; i++)
                {
                    var id = _settle.Dequeue();
                    _settleQueued.Remove(id);
                    reads.Add((id, true));
                    if (elapsedMs() >= budgetMs)
                    {
                        return Finish(reads, firstReads, notReady);
                    }
                }

                var waiting = _first.Count;
                for (var i = 0; i < waiting; i++)
                {
                    var id = _first.Dequeue();
                    if (!ready(id))
                    {
                        notReady.Add(id);
                        continue;
                    }

                    _firstQueued.Remove(id);
                    _misses.Remove(id);
                    reads.Add((id, false));
                    firstReads.Add(id);
                    if (elapsedMs() >= budgetMs)
                    {
                        for (var rest = i + 1; rest < waiting; rest++)
                        {
                            notReady.Add(_first.Dequeue());
                        }

                        break;
                    }
                }

                return Finish(reads, firstReads, notReady);
            }
        }

        private List<(string Id, bool Publish)> Finish(List<(string Id, bool Publish)> reads, List<string> firstReads, List<string> notReady)
        {
            foreach (var id in firstReads)
            {
                if (_settleQueued.Add(id))
                {
                    _settle.Enqueue(id);
                }
            }

            foreach (var id in notReady)
            {
                _misses.TryGetValue(id, out var misses);
                if (++misses >= 30)
                {
                    _misses.Remove(id);
                    _firstQueued.Remove(id);
                }
                else
                {
                    _misses[id] = misses;
                    _first.Enqueue(id);
                }
            }

            return reads;
        }
    }
}
