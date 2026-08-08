// GonogoMechJebUplink: GPLv3. See GonogoMechJebUplink.csproj's header comment
// for the licence/linkage rationale.

using System;
using System.Collections.Concurrent;
using System.Threading;

namespace Gonogo.MechJebUplink
{
    /// <summary>
    /// The main-thread dispatch spine every MechJeb2/vessel touch must route
    /// through: MechJeb2 (like every other KSP/Unity API) mutates its
    /// autopilot state on the KSP/Unity main thread; the Sitrep SDK pump (the
    /// WebSocket read/write loop) is a BACKGROUND thread. Calling a MechJeb2
    /// member directly from that thread races Unity in exactly the way
    /// <c>GonogoKosUplink.MainThreadDispatcher</c>'s doc comment describes
    /// for kOS: this class is that same spine, copied and renamed for this
    /// Uplink (each Uplink owns its own dispatcher instance; there is no
    /// shared one to reuse across optional, independently-deployed
    /// extensions).
    ///
    /// Deliberately has ZERO UnityEngine dependency so it is fully
    /// unit-testable outside the KSP/Unity process. The Unity-touching half
    /// (the addon that calls <see cref="Drain"/> from <c>Update()</c>) is a
    /// separate, thin class for exactly this reason
    /// (<c>MechJebMainThreadDispatcherAddon</c>, MechJebUplink.Ksp.cs).
    /// </summary>
    public sealed class MainThreadDispatcher
    {
        private readonly ConcurrentQueue<Action> _queue = new ConcurrentQueue<Action>();
        private readonly Action<Exception> _onActionError;

        // Managed thread id of the thread that drains this dispatcher (the KSP
        // main thread in production). Recorded on every Drain so a caller can
        // ask -- via IsOnDrainThread -- whether it is ALREADY running on that
        // thread and must therefore NOT Dispatch-and-block (which would wedge
        // the whole main thread). -1 until the first Drain; ManagedThreadId is
        // always >= 1, so the sentinel can never collide with a real thread.
        private volatile int _drainThreadId = -1;

        /// <param name="onActionError">
        /// Invoked, on the draining thread, for every action that throws
        /// during <see cref="Drain"/>. Defaults to a no-op so a caught
        /// exception never escapes <see cref="Drain"/> even if the caller
        /// supplies nothing.
        /// </param>
        public MainThreadDispatcher(Action<Exception>? onActionError = null)
        {
            _onActionError = onActionError ?? (_ => { });
        }

        /// <summary>
        /// Schedules <paramref name="action"/> to run on the next
        /// <see cref="Drain"/>, FIFO relative to every other currently- or
        /// previously-enqueued action. Safe to call from ANY thread.
        /// </summary>
        public void Dispatch(Action action)
        {
            if (action == null)
            {
                throw new ArgumentNullException(nameof(action));
            }

            _queue.Enqueue(action);
        }

        /// <summary>
        /// Runs every action queued as of entry, in FIFO order, on the
        /// CALLING thread, which MUST be the KSP main thread in production.
        /// Each action runs in its own try/catch so one throwing action can
        /// never stall or drop the actions behind it. Bounded to a snapshot
        /// of the queue's length at entry so a self-dispatching action cannot
        /// extend a single Drain call indefinitely.
        /// </summary>
        public void Drain()
        {
            _drainThreadId = Thread.CurrentThread.ManagedThreadId;

            var count = _queue.Count;
            for (var i = 0; i < count; i++)
            {
                if (!_queue.TryDequeue(out var action))
                {
                    break; // unreachable in practice: only this method dequeues.
                }

                try
                {
                    action();
                }
                catch (Exception ex)
                {
                    _onActionError(ex);
                }
            }
        }

        /// <summary>Actions currently queued, awaiting the next <see cref="Drain"/>. Test/diagnostic use.</summary>
        public int PendingCount => _queue.Count;

        /// <summary>
        /// True iff the calling thread IS the thread that drains this
        /// dispatcher (recorded on the most recent <see cref="Drain"/>): the
        /// reentrancy signal that lets <see cref="MechJebUplink.RunOnMainThread"/>
        /// run inline rather than Dispatch-and-block when it is already ON
        /// the main thread. False until the first <see cref="Drain"/>.
        /// </summary>
        public bool IsOnDrainThread => _drainThreadId == Thread.CurrentThread.ManagedThreadId;
    }
}
