using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// Which Topics the armed alarms need kept on the record, and the opens and
    /// closes that get from the last answer to this one.
    ///
    /// <para>A threshold read at a vantage goes through the archive, and the
    /// archive holds only what something was subscribed to, so an alarm at a
    /// command centre's vantage would fire or not depending on which widgets the
    /// operator happened to have open. A standing subscription is what takes the
    /// dashboard out of that answer.</para>
    ///
    /// <para><b>One holder per alarm</b>, rather than one for the whole arm. The
    /// holder is what a leaked subscription is blamed on, and an alarm is the
    /// thing an operator armed and can point at; a single holder for everything
    /// would say only that the alarm arm leaks. It also does the counting for
    /// free: two alarms on one Topic are two holders, so disarming either leaves
    /// the other's hold standing.</para>
    ///
    /// <para>KSP-free and engine-free: it is told a roster and answers in calls,
    /// so what it decides is exercisable headlessly, the same way
    /// <see cref="ScetAlarmRoster"/> and <see cref="ScetRosterAudience"/>
    /// are.</para>
    /// </summary>
    public sealed class ScetAlarmSubscriptions
    {
        private const string HolderPrefix = "scet-alarm:";

        private readonly Action<string, string> _open;
        private readonly Action<string, string> _close;

        /// <summary>
        /// Alarm id -&gt; the Topic held for it. What the last
        /// <see cref="Reconcile"/> left open, which is the only thing a close can
        /// be derived from: the roster that comes in carries where the alarm is
        /// NOW, and an alarm that moved Topics has to let go of the one it left.
        /// </summary>
        private readonly Dictionary<string, string> _held =
            new Dictionary<string, string>(StringComparer.Ordinal);

        public ScetAlarmSubscriptions(Action<string, string> open, Action<string, string> close)
        {
            _open = open ?? throw new ArgumentNullException(nameof(open));
            _close = close ?? throw new ArgumentNullException(nameof(close));
        }

        /// <summary>
        /// Bring the standing subscriptions in line with <paramref name="roster"/>.
        ///
        /// <para>Only an ARMED threshold is wanted. A time condition addresses no
        /// Topic, and an alarm that has fired or gone unreachable will never take
        /// another reading, so keeping its Topic recorded would pin a history
        /// nothing is going to read.</para>
        /// </summary>
        public void Reconcile(IEnumerable<ScetAlarm>? roster)
        {
            var wanted = new Dictionary<string, string>(StringComparer.Ordinal);
            if (roster != null)
            {
                foreach (var alarm in roster)
                {
                    if (alarm == null || string.IsNullOrEmpty(alarm.Id) || alarm.State != ScetAlarmState.Armed)
                    {
                        continue;
                    }
                    var condition = alarm.Condition;
                    if (condition == null
                        || condition.Kind != ScetAlarmConditionKind.Threshold
                        || string.IsNullOrEmpty(condition.Topic))
                    {
                        continue;
                    }
                    wanted[alarm.Id!] = condition.Topic!;
                }
            }

            // Closed before opened, so an alarm that moved Topics does not hold
            // both across the gap.
            foreach (var entry in _held)
            {
                if (!wanted.TryGetValue(entry.Key, out var topic)
                    || !string.Equals(topic, entry.Value, StringComparison.Ordinal))
                {
                    _close(entry.Value, HolderPrefix + entry.Key);
                }
            }

            foreach (var entry in wanted)
            {
                if (!_held.TryGetValue(entry.Key, out var topic)
                    || !string.Equals(topic, entry.Value, StringComparison.Ordinal))
                {
                    _open(entry.Value, HolderPrefix + entry.Key);
                }
            }

            _held.Clear();
            foreach (var entry in wanted)
            {
                _held[entry.Key] = entry.Value;
            }
        }
    }
}
