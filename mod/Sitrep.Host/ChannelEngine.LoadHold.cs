using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Threading;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// Commands sent while the game is loading a scene. The game's main thread
    /// runs nothing of ours for the whole of a load, and a switch to a craft
    /// that is not loaded is one, so a command sent then is kept here and
    /// dispatched once the scene stands, as if it had been sent at that moment.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        /// <summary>
        /// How long a command waits for a load before it is failed. The same
        /// figure a load mark waits for its save, for the same reason: scene
        /// loads of a heavily modded game run to tens of seconds.
        /// </summary>
        internal TimeSpan LoadHoldLimit { get; set; } = LoadMarkLimit;

        /// <summary>
        /// How long after a load ends a held command waits for a tick to release
        /// it, before it is released without one, as in a scene whose clock does
        /// not advance.
        /// </summary>
        private static readonly TimeSpan LoadHoldWaitsForATick = TimeSpan.FromSeconds(2);

        private sealed class HeldForLoad
        {
            public DispatchCommandJob Job = null!;
            public string? PendingId;
            public long HeldAt;
        }

        /// <summary>Courier thread: the commands waiting for the scene to stand, oldest first.</summary>
        private readonly List<HeldForLoad> _heldForLoad = new List<HeldForLoad>();

        /// <summary>The stopwatch timestamp the game last stopped loading at, or 0 when it has not since this run began.</summary>
        private long _loadEndedAt;

        /// <summary>Main thread, from <see cref="SetGameState"/>: notes the moment a load ends.</summary>
        private void NoteLoading(bool loading)
        {
            var was = _gameLoading;
            _gameLoading = loading;
            if (was && !loading)
            {
                Volatile.Write(ref _loadEndedAt, Stopwatch.GetTimestamp());
            }
        }

        /// <summary>
        /// Courier thread: keeps <paramref name="job"/> for the end of the load
        /// in progress and returns true, or returns false when the game is not
        /// loading. The sender is told the command is accepted and how long it
        /// can wait, and <paramref name="listed"/> puts it in the pending queue
        /// as held at the centre that sent it.
        /// </summary>
        private bool HoldWhileLoading(DispatchCommandJob job, bool listed)
        {
            if (!_gameLoading)
            {
                return false;
            }

            var now = PressUt();
            var held = new HeldForLoad { Job = job, HeldAt = Stopwatch.GetTimestamp() };
            if (listed)
            {
                var id = NextRequestId();
                held.PendingId = id;
                if (job.SessionId != null)
                {
                    _pendingDispatcher[id] = job.SessionId;
                }
                _pending.Add(new PendingUplink
                {
                    Id = id,
                    ClientRequestId = job.ClientRequestId,
                    Command = job.Command,
                    Label = job.Label ?? "",
                    Topic = job.Topic ?? "",
                    Vantage = job.Vantage,
                    DispatchedAt = now,
                    OneWaySeconds = null,
                    PredictedHeldAt = job.Vantage,
                    PredictedHeldFromUt = now,
                    Attempts = 1,
                    Members = new List<string> { id },
                    MemberCommands = new List<string> { job.Command },
                });
            }
            _heldForLoad.Add(held);

            /*
             * The sender's own deadline for an answer was sized for a command in
             * flight, which this one is not. The expiry is in game time, which
             * stands still for the load, so it cannot run out before the bound
             * here does.
             */
            var expiresAtUt = now + LoadHoldLimit.TotalSeconds;
            if (job.OnAcceptedHeld != null)
            {
                job.OnAcceptedHeld(null, null, expiresAtUt, null);
            }
            else
            {
                job.OnAccepted?.Invoke(null);
            }
            return true;
        }

        /// <summary>Courier thread, at the end of a tick: dispatches what was held, once the game is no longer loading.</summary>
        private void ReleaseHeldForLoad()
        {
            if (_heldForLoad.Count == 0 || _gameLoading)
            {
                return;
            }
            var released = _heldForLoad.ToArray();
            _heldForLoad.Clear();
            foreach (var held in released)
            {
                Unlist(held);
                ProcessDispatchCommand(held.Job);
            }
        }

        /// <summary>
        /// Courier thread, on every wake of its loop: fails a command whose load
        /// has run past <see cref="LoadHoldLimit"/>, and releases the rest when
        /// the load has ended and no tick has come to do it.
        /// </summary>
        private void WatchHeldForLoad()
        {
            if (_heldForLoad.Count == 0)
            {
                return;
            }
            var now = Stopwatch.GetTimestamp();
            if (!_gameLoading)
            {
                var endedAt = Volatile.Read(ref _loadEndedAt);
                if (endedAt == 0 || Elapsed(endedAt, now) >= LoadHoldWaitsForATick)
                {
                    ReleaseHeldForLoad();
                }
                return;
            }
            for (var i = _heldForLoad.Count - 1; i >= 0; i--)
            {
                var held = _heldForLoad[i];
                if (Elapsed(held.HeldAt, now) < LoadHoldLimit)
                {
                    continue;
                }
                _heldForLoad.RemoveAt(i);
                Unlist(held);
                held.Job.OnRefused?.Invoke(
                    FaultCode.MainThreadTimeout,
                    "the game's main thread did not run the command within " + LoadHoldLimit.TotalSeconds.ToString("F0", CultureInfo.InvariantCulture) + "s");
                held.Job.Done?.Set();
            }
        }

        private void Unlist(HeldForLoad held)
        {
            if (held.PendingId == null)
            {
                return;
            }
            _pending.RemoveAll(entry => string.Equals(entry.Id, held.PendingId, StringComparison.Ordinal));
            _pendingDispatcher.Remove(held.PendingId);
        }

        private static TimeSpan Elapsed(long from, long to) =>
            TimeSpan.FromSeconds((to - from) / (double)Stopwatch.Frequency);
    }
}
