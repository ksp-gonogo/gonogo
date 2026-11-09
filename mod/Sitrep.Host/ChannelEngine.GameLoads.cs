using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using Sitrep.Contract;
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

        /// <summary>Where the channels stand after a timeline reset, on the way to their first frames of the new timeline.</summary>
        private enum WorldWait
        {
            /// <summary>No reset is being settled.</summary>
            None,

            /// <summary>The game is still building the loaded world, so no state channel may speak.</summary>
            Loading,

            /// <summary>The world stands. Sampled channels are reading it; what is left is settled on the next tick.</summary>
            Settling,
        }

        /// <summary>Set by <see cref="SetGameState"/>, read when a tick is captured.</summary>
        private volatile bool _gameLoading;

        /// <summary>Courier thread: this timeline's progress towards its first frames.</summary>
        private WorldWait _worldWait = WorldWait.None;

        /// <summary>Courier thread: the newest publish each state topic made while the world was loading.</summary>
        private readonly Dictionary<string, PublishJob> _heldUntilWorldStands = new Dictionary<string, PublishJob>(StringComparer.Ordinal);

        /// <summary>
        /// Courier thread, from a timeline reset: holds every state channel's first
        /// frame until the loaded world can be read. What the archive retained and a
        /// reading taken mid-load both describe something other than that world.
        /// </summary>
        private void AwaitLoadedWorld()
        {
            _worldWait = WorldWait.Loading;
            _heldUntilWorldStands.Clear();
        }

        /*
         * Courier thread, once per tick after the reset test. The settling happens a
         * tick after the world stood because a sampler's publish from that tick is
         * queued behind it, and a topic that has just read the loaded world must not
         * be sent anything older first.
         */
        private void AdvanceWorldWait(bool gameLoading)
        {
            if (_worldWait == WorldWait.Loading && !gameLoading)
            {
                _worldWait = WorldWait.Settling;
                return;
            }
            if (_worldWait == WorldWait.Settling)
            {
                SettleFirstFrames();
                _worldWait = WorldWait.None;
            }
        }

        /*
         * A sampled channel is sent what its vantage had heard at the save only when
         * the vantage is a delay away: its forced keyframe has read the loaded world,
         * and that frame is still crossing. With no delay the frame is already there,
         * or the channel has said by staying silent that it has nothing to read.
         * A pushed channel that publishes only on change would otherwise stay blank
         * until its value next moved.
         */
        private void SettleFirstFrames()
        {
            foreach (var held in _heldUntilWorldStands.Values.ToList())
            {
                ProcessPublish(held);
            }
            _heldUntilWorldStands.Clear();
            _courier.ReissueRetainedAfterReset(
                topic => DeclarationOf(topic)?.Kind != SampleKind.Event,
                topic => _channelSources.ContainsKey(topic));
        }

        /// <summary>
        /// Courier thread: whether <paramref name="publish"/> waits for the loaded
        /// world. An event is news of the moment it happened, so it is never held.
        /// </summary>
        private bool HoldUntilWorldStands(PublishJob publish)
        {
            if (_worldWait == WorldWait.None)
            {
                return false;
            }
            if (_worldWait == WorldWait.Loading && DeclarationOf(publish.Topic)?.Kind != SampleKind.Event)
            {
                _heldUntilWorldStands[publish.Topic] = publish;
                return true;
            }
            _heldUntilWorldStands.Remove(publish.Topic);
            return false;
        }

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
                KeepHistoryFromOldestOwnSave();
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
                KeepHistoryFromOldestOwnSave();
            }
        }

        /// <summary>Under <see cref="_ownSavesGate"/>: the archive keeps what a load of any save it holds would rewind to.</summary>
        private void KeepHistoryFromOldestOwnSave() =>
            _courier.RetainHistoryFrom(_ownSaves.Count == 0 ? double.NegativeInfinity : _ownSaves.Values.Min());

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
