using System.Diagnostics;
using System.Threading;

namespace Sitrep.Host
{
    /// <summary>
    /// Where an engine's Courier thread is inside the job it is running, as a
    /// named step, and which step of one sampled-source handle took longest.
    /// The engine names its own phases and each handle; a handle names its
    /// own steps with <see cref="Mark"/>. Steps are entered and charged on the
    /// Courier thread only; the step in progress may be read from any thread.
    /// </summary>
    internal sealed class CourierSteps
    {
        [System.ThreadStatic]
        private static CourierSteps? _onThisThread;

        private string? _step;
        private string? _handle;
        private long _stepStarted;
        private long _slowestTicks;
        private string? _slowestName;
        private bool _handleMarked;

        /// <summary>The stopwatch timestamp steps are charged by. A test replaces it to make one step longest by construction.</summary>
        internal System.Func<long> Timestamp { get; set; } = Stopwatch.GetTimestamp;

        /// <summary>Makes <paramref name="steps"/> the one <see cref="Mark"/> charges on the calling thread, which is the Courier thread it belongs to.</summary>
        public static void Bind(CourierSteps steps) => _onThisThread = steps;

        /// <summary>
        /// Names the step a sampled-source handle is in from now. The time since
        /// the last step was named is charged to that step. Does nothing on a
        /// thread with no engine's Courier bound, as in a test that calls a
        /// handle directly.
        /// </summary>
        public static void Mark(string step)
        {
            var steps = _onThisThread;
            if (steps != null && steps._handle != null)
            {
                steps.Enter(step);
                steps._handleMarked = true;
            }
        }

        /// <summary>Starts one handle, whose steps are compared among themselves.</summary>
        public void BeginHandle(string name)
        {
            Enter("start");
            Volatile.Write(ref _handle, name);
            _slowestTicks = 0;
            _slowestName = null;
            _handleMarked = false;
        }

        /// <summary>
        /// Ends the handle, and answers the step of it that took longest, or a
        /// null name when it named none of its own. Time before its first step
        /// is the step "start".
        /// </summary>
        public (long Ticks, string? Name) EndHandle()
        {
            Close(Timestamp());
            Volatile.Write(ref _handle, null);
            Volatile.Write(ref _step, null);
            return _handleMarked ? (_slowestTicks, _slowestName) : (0L, null);
        }

        /// <summary>Names the step in progress, charging the one before it.</summary>
        public void Enter(string step)
        {
            var now = Timestamp();
            Close(now);
            Volatile.Write(ref _stepStarted, now);
            Volatile.Write(ref _step, step);
        }

        /// <summary>Leaves every step: the Courier is between jobs.</summary>
        public void Clear()
        {
            Volatile.Write(ref _handle, null);
            Volatile.Write(ref _step, null);
        }

        /// <summary>
        /// The handle and step in progress, and the stopwatch timestamp the step
        /// was entered at; a null step between jobs. Any thread. The three are
        /// read separately, so a step that has just changed may pair with the
        /// time of the one before.
        /// </summary>
        public (string? Handle, string? Step, long Since) Current =>
            (Volatile.Read(ref _handle), Volatile.Read(ref _step), Volatile.Read(ref _stepStarted));

        private void Close(long now)
        {
            if (_step == null)
            {
                return;
            }
            var spent = now - _stepStarted;
            if (spent > _slowestTicks)
            {
                _slowestTicks = spent;
                _slowestName = _step;
            }
        }
    }
}
