// GonogoKosUplink — GPLv3. See GonogoKosUplink.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Concurrent;
using System.Threading;

namespace Gonogo.KosUplink
{
    /// <summary>
    /// The main-thread dispatch spine every kOS touch must route through —
    /// local_docs/telemetry-mod/kos-migration-spec.md §2, the adversarial
    /// review's #1 must-have. kOS mutates all terminal/screen/volume state
    /// on the KSP/Unity main thread and does so WITHOUT locking (e.g.
    /// <c>CharInputQueue</c> is a plain unlocked <c>Queue&lt;char&gt;</c> —
    /// spec §1/§2). The Sitrep SDK pump (the WebSocket read/write loop) is
    /// a BACKGROUND thread. Calling any kOS member directly from that
    /// thread races the VM and Unity — intermittent, load-dependent
    /// <c>NullReferenceException</c>s, "Collection was modified", and
    /// Unity main-thread asserts that will not reproduce under a light
    /// test.
    ///
    /// The rule this class exists to enforce: background code NEVER
    /// touches a kOS member directly. It only <see cref="Dispatch"/>es an
    /// <see cref="Action"/>; something on the KSP main thread (in
    /// production, <see cref="KosMainThreadDispatcherAddon.Update"/>)
    /// calls <see cref="Drain"/> once per frame. Every P1+ kOS call
    /// (input inject, screen poll, file I/O,
    /// <c>kOSProcessor.AllInstances()</c>, the <c>Print</c>-postfix
    /// handoff) is a <c>Dispatcher.Dispatch(() =&gt; ...)</c> through this
    /// class — no exceptions.
    ///
    /// Deliberately has ZERO UnityEngine dependency so it is fully
    /// unit-testable outside the KSP/Unity process — see
    /// GonogoKosUplink.Tests/MainThreadDispatcherTests.cs. The Unity-touching
    /// half (the addon that calls <see cref="Drain"/> from
    /// <c>Update()</c>) is a separate, thin class for exactly this reason.
    /// </summary>
    public sealed class MainThreadDispatcher
    {
        private readonly ConcurrentQueue<Action> _queue = new ConcurrentQueue<Action>();
        private readonly Action<Exception> _onActionError;

        // Managed thread id of the thread that drains this dispatcher (the KSP
        // main thread in production, where KosMainThreadDispatcherAddon.Update
        // calls Drain every frame). Recorded on every Drain so a caller can ask
        // — via IsOnDrainThread — whether it is ALREADY running on that thread
        // and must therefore NOT Dispatch-and-block (which would wedge the whole
        // main thread: the Drain that would run the queued action can never run
        // while the same thread is parked waiting on it). -1 until the first
        // Drain; ManagedThreadId is always >= 1, so the sentinel can never
        // collide with a real thread.
        private volatile int _drainThreadId = -1;

        /// <param name="onActionError">
        /// Invoked, on the draining thread, for every action that throws
        /// during <see cref="Drain"/> — so the caller decides how to
        /// surface it (production: <c>UnityEngine.Debug.LogError</c>,
        /// wired by <see cref="KosExtension"/>; tests: a capturing
        /// delegate). Defaults to a no-op so a caught exception never
        /// escapes <see cref="Drain"/> even if the caller supplies
        /// nothing — a throwing action must never be able to stall or
        /// crash the drain loop.
        /// </param>
        public MainThreadDispatcher(Action<Exception>? onActionError = null)
        {
            _onActionError = onActionError ?? (_ => { });
        }

        /// <summary>
        /// Schedules <paramref name="action"/> to run on the next
        /// <see cref="Drain"/>, FIFO relative to every other currently- or
        /// previously-enqueued action. Safe to call from ANY thread — this
        /// is the ONLY thread-safe entry point background code (the
        /// Sitrep pump) may use to reach a kOS call.
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
        /// CALLING thread — this MUST be the KSP main thread (production:
        /// called from <see cref="KosMainThreadDispatcherAddon.Update"/>).
        /// Each action runs in its own try/catch so one throwing action
        /// can never stall or drop the actions behind it — the failure is
        /// reported via the constructor's <c>onActionError</c> callback
        /// and the drain continues immediately with the next action.
        /// Calling <see cref="Drain"/> against an empty queue is a safe,
        /// idempotent no-op.
        ///
        /// Bounded to a snapshot of the queue's length at entry (rather
        /// than an unbounded <c>while (TryDequeue)</c>): an action that
        /// itself calls <see cref="Dispatch"/> — or a background producer
        /// that never lets up — must not be able to extend a single
        /// <see cref="Drain"/> call indefinitely and blow the frame
        /// budget. Anything enqueued during this drain simply waits for
        /// the next one.
        /// </summary>
        public void Drain()
        {
            // Record the draining thread so re-entrant callers already on it can
            // detect the case and run inline instead of self-deadlocking (see
            // IsOnDrainThread / KosExtension.RunOnMainThread).
            _drainThreadId = Thread.CurrentThread.ManagedThreadId;

            var count = _queue.Count;
            for (var i = 0; i < count; i++)
            {
                if (!_queue.TryDequeue(out var action))
                {
                    // Nothing else can remove from this queue (only this
                    // method dequeues), so this is unreachable in
                    // practice — defensive only.
                    break;
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
        /// dispatcher (recorded on the most recent <see cref="Drain"/>). The
        /// reentrancy signal that lets a main-thread-marshalling caller
        /// (<see cref="KosExtension.RunOnMainThread"/>) run inline rather than
        /// <see cref="Dispatch"/>-and-block when it is already ON the main
        /// thread — the production reality once the <c>ChannelEngine</c> has
        /// marshalled a command handler onto the main-thread pump. False until
        /// the first <see cref="Drain"/> (nothing has claimed the thread yet).
        /// </summary>
        public bool IsOnDrainThread => _drainThreadId == Thread.CurrentThread.ManagedThreadId;
    }
}
