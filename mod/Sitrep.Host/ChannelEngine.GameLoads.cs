using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using Sitrep.Core;
using Sitrep.Core.StoreAndForward;

namespace Sitrep.Host
{
    /// <summary>
    /// Which game loads start a timeline and how much history each keeps. A load the
    /// game marks resets once, when its save arrives, never also on the clock going
    /// back. A save this run wrote on the timeline being played rewinds to it; any
    /// other save starts with no history.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        /// <summary>
        /// How long a mark waits for its save before the engine stops holding the
        /// clock-went-back test for it. Scene loads of a heavily modded game run to
        /// tens of seconds, and ticks barely flow while one runs.
        /// </summary>
        private static readonly TimeSpan LoadMarkLimit = TimeSpan.FromSeconds(90);

        private readonly object _ownSavesGate = new object();

        /// <summary>The saves this run wrote or loaded whose history is still in the archive, by token, with their UT.</summary>
        private readonly Dictionary<string, double> _ownSaves = new Dictionary<string, double>(StringComparer.Ordinal);

        /// <summary>The stopwatch timestamp of the load mark awaiting its save, or 0 when none is.</summary>
        private long _loadMarkedAt;

        private int _loadsMarked;
        private int _loadMarkGaveWay;
        private int _gameRewound;

        /// <summary>Courier thread: the lowest tick UT seen while a mark held the clock-went-back test.</summary>
        private double _lowestTickWhileMarked = double.PositiveInfinity;

        /// <summary>
        /// Courier thread: the commands the last reset told a load undid them, by
        /// delivery message id or live-path request id, and the mark count at that
        /// reset. A second reset of the same load must not bring them back, a later
        /// load may.
        /// </summary>
        private HashSet<string> _undoneByLastReset = new HashSet<string>(StringComparer.Ordinal);

        private int _undoneAtLoadsMarked;

        private int _timelineResets;
        private double _lastTimelineResetUt = double.NaN;

        internal int TimelineResetsForTests => Volatile.Read(ref _timelineResets);

        internal double LastTimelineResetUtForTests => _lastTimelineResetUt;

        /// <summary>
        /// The game has finished loading a save and is about to put its world in
        /// place. Until the save arrives through <see cref="NoteGameLoaded"/> or
        /// <see cref="NoteSaveReloaded"/>, the clock going back starts no timeline
        /// of its own. Callable from any thread.
        /// </summary>
        public void NoteLoadStarted()
        {
            Interlocked.Increment(ref _loadsMarked);
            var now = Stopwatch.GetTimestamp();
            Interlocked.Exchange(ref _loadMarkedAt, now == 0 ? 1 : now);
        }

        /// <summary>
        /// The marked load reached a scene that hands over no save, so the clock
        /// going back while the mark was held is taken as it would have been
        /// without one. Callable from any thread.
        /// </summary>
        public void NoteLoadAbandoned()
        {
            if (Interlocked.Exchange(ref _loadMarkedAt, 0) != 0)
            {
                Interlocked.Exchange(ref _loadMarkGaveWay, 1);
            }
        }

        private bool IsOwnSaveOnThisTimeline(string? token)
        {
            if (token == null)
            {
                return false;
            }
            lock (_ownSavesGate)
            {
                return _ownSaves.ContainsKey(token);
            }
        }

        private void RememberOwnSave(string? token, double ut)
        {
            if (token == null || double.IsNaN(ut) || double.IsInfinity(ut))
            {
                return;
            }
            lock (_ownSavesGate)
            {
                _ownSaves[token] = ut;
            }
        }

        /// <summary>Forgets every save whose history a reset to <paramref name="ut"/> dropped, all of them for negative infinity.</summary>
        private void ForgetOwnSavesAfter(double ut)
        {
            lock (_ownSavesGate)
            {
                foreach (var token in _ownSaves.Where(entry => entry.Value > ut + 0.001).Select(entry => entry.Key).ToList())
                {
                    _ownSaves.Remove(token);
                }
            }
        }

        private bool TakeGameRewound() => Interlocked.Exchange(ref _gameRewound, 0) == 1;

        /// <summary>
        /// Courier thread, once per tick before the reset test: whether a load mark
        /// is still waiting for its save, giving way to the clock-went-back test
        /// once it has waited past <see cref="LoadMarkLimit"/>.
        /// </summary>
        private bool LoadMarkHeld()
        {
            var markedAt = Volatile.Read(ref _loadMarkedAt);
            if (markedAt == 0)
            {
                return false;
            }
            var waited = TimeSpan.FromSeconds((Stopwatch.GetTimestamp() - markedAt) / (double)Stopwatch.Frequency);
            if (waited < LoadMarkLimit)
            {
                return true;
            }
            if (Interlocked.CompareExchange(ref _loadMarkedAt, 0, markedAt) == markedAt)
            {
                Interlocked.Exchange(ref _loadMarkGaveWay, 1);
                LogHost("a game load was marked " + waited.TotalSeconds.ToString("F0", System.Globalization.CultureInfo.InvariantCulture)
                    + " s ago and no save has arrived, so the clock going back is taken on its own");
            }
            return false;
        }

        private bool TakeLoadMarkGaveWay() => Interlocked.Exchange(ref _loadMarkGaveWay, 0) == 1;

        /// <summary>Courier thread: what a reset just did, for the tests and the next reset.</summary>
        private void CountTimelineReset(double ut)
        {
            _lastTimelineResetUt = ut;
            _lowestTickWhileMarked = double.PositiveInfinity;
            Interlocked.Increment(ref _timelineResets);
        }

        /// <summary>
        /// <paramref name="carried"/> without the commands the previous reset of the
        /// same load told they will not run. Their requests have settled, so running
        /// them now would act on the craft with no screen expecting it.
        /// </summary>
        private DeliverySnapshot? WithoutUndone(DeliverySnapshot? carried)
        {
            if (carried == null || _undoneByLastReset.Count == 0 || _undoneAtLoadsMarked != Volatile.Read(ref _loadsMarked))
            {
                return carried;
            }
            var undone = _undoneByLastReset;
            bool Kept(DeliveryMessage message) =>
                !undone.Contains(message.Id)
                && !(message is CommandMessage command && command.ClientRequestId.Length > 0 && undone.Contains(command.ClientRequestId));
            return new DeliverySnapshot
            {
                Held = carried.Held.Where(record => Kept(record.Message)).ToList(),
                Flights = carried.Flights.Where(record => Kept(record.Message)).ToList(),
                StoredCancels = carried.StoredCancels,
                Senders = carried.Senders,
                Collectors = carried.Collectors,
                SentCommands = carried.SentCommands.Where(Kept).ToList(),
                NextId = carried.NextId,
                Retargets = carried.Retargets,
                LivePath = new CommandQueueState
                {
                    Commands = carried.LivePath.Commands
                        .Where(command => !undone.Contains(command.RequestId) && !(command.Correlation.Length > 0 && undone.Contains(command.Correlation)))
                        .ToList(),
                },
            };
        }

        /// <summary>Courier thread: remembers which commands this reset told a load undid them, for the next reset of the same load.</summary>
        private void RememberUndone(IEnumerable<string> ids)
        {
            _undoneByLastReset = new HashSet<string>(ids.Where(id => id.Length > 0), StringComparer.Ordinal);
            _undoneAtLoadsMarked = Volatile.Read(ref _loadsMarked);
        }
    }
}
