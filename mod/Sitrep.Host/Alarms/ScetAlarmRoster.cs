using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// What one <see cref="ScetAlarmRoster.Evaluate"/> decided, for the caller
    /// to act on: whether to stop the warp, which notices to publish, and
    /// whether the roster changed enough to republish.
    /// </summary>
    public sealed class ScetAlarmTick
    {
        /// <summary>
        /// True when at least one alarm reached its step-down instant or its
        /// firing instant on this evaluation. The caller stops the warp ONCE per
        /// tick however many alarms asked, which is why this is a flag and not a
        /// count: two alarms coming due together are one stop.
        /// </summary>
        public bool StopWarp { get; set; }

        /// <summary>The notices to publish, in the order the alarms were armed.</summary>
        public List<ScetAlarmFired> Fired { get; } = new List<ScetAlarmFired>();

        /// <summary>Whether <see cref="ScetAlarmRoster.Snapshot"/> would now differ from the last one published.</summary>
        public bool RosterChanged { get; set; }
    }

    /// <summary>
    /// The armed set of SCET alarms and the decision of when each comes due.
    /// KSP-free and clock-free: it is told the universal time and answers what
    /// should happen, so the whole arm can be exercised headlessly.
    ///
    /// <para>A SCET alarm is evaluated against the game's OWN clock, upstream of
    /// the reveal gate, which is the entire point of it. A client cannot do this
    /// for itself: it holds only readings a light-time old, and the light time
    /// moves continuously, so subtracting it once at the moment the operator
    /// clicks is right for that instant and wrong by however much the geometry
    /// drifted by the time the alarm was due.</para>
    ///
    /// <para>Two instants per alarm, mirroring what the client's own alarm state
    /// machine does on its own clock: warp stops at <c>ut - leadSeconds</c> so
    /// the operator has real time in hand, and the alarm fires at <c>ut</c>,
    /// which arrives shortly after in real time because the warp is by then
    /// already stopped. Both are LATCHED rather than level-tested, so one warp
    /// step that jumps clean over both does both, once, on the tick it lands.</para>
    /// </summary>
    public sealed class ScetAlarmRoster
    {
        /// <summary>
        /// A backward jump larger than this is a different timeline rather than
        /// a clock jitter. Generous, because the only thing on the other side of
        /// it is a quickload or a revert, and nothing legitimately steps UT
        /// backwards by a second.
        /// </summary>
        private const double RewindToleranceSeconds = 1.0;

        private sealed class Entry
        {
            public ScetAlarm Alarm = new ScetAlarm();

            /// <summary>Whether this alarm has already asked for the warp to stop.</summary>
            public bool SteppedDown;
        }

        /// <summary>Insertion-ordered so the roster, and the notices off it, keep the order the operator armed things in.</summary>
        private readonly List<Entry> _entries = new List<Entry>();

        private double? _lastEvaluatedUt;

        /// <summary>How many alarms are held, armed or fired. For a health report and for tests.</summary>
        public int Count => _entries.Count;

        /// <summary>
        /// Register an alarm, or REPLACE the one already held under the same id.
        ///
        /// <para>Replace rather than reject, so a client re-arming after a
        /// reconnect is idempotent and cannot leave a duplicate row. A replaced
        /// entry loses its latches with its old condition, which is correct: the
        /// operator moved the instant, so the alarm has not fired at the new
        /// one.</para>
        ///
        /// <para>Returns whether the roster now differs from before, so a caller
        /// republishes only on a real change.</para>
        /// </summary>
        public bool Arm(ScetAlarmArmArgs? args, string armedBy)
        {
            if (args == null || string.IsNullOrEmpty(args.Id))
            {
                return false;
            }

            var condition = args.Condition ?? new ScetAlarmCondition();
            var alarm = new ScetAlarm
            {
                Id = args.Id,
                Name = args.Name ?? "",
                ArmedBy = armedBy ?? "",
                Subject = string.IsNullOrEmpty(args.Subject) ? "game" : args.Subject,
                Condition = new ScetAlarmCondition
                {
                    Kind = condition.Kind,
                    Ut = condition.Ut,
                    LeadSeconds = condition.LeadSeconds,
                },
                State = ScetAlarmState.Armed,
                FiredAtUt = null,
            };

            var index = IndexOf(args.Id);
            if (index >= 0)
            {
                if (SameAs(_entries[index].Alarm, alarm))
                {
                    return false;
                }
                _entries[index] = new Entry { Alarm = alarm };
                return true;
            }

            _entries.Add(new Entry { Alarm = alarm });
            return true;
        }

        /// <summary>
        /// Forget the alarm with this id. Silently succeeds for an id that is
        /// not held, so a client reconciling its own list against the roster
        /// never has to ask first.
        /// </summary>
        public bool Disarm(string? id)
        {
            if (string.IsNullOrEmpty(id))
            {
                return false;
            }
            var index = IndexOf(id!);
            if (index < 0)
            {
                return false;
            }
            _entries.RemoveAt(index);
            return true;
        }

        /// <summary>
        /// Drop everything. Used on a timeline rewind: a fired latch is a
        /// statement about a timeline that no longer exists, and so is an arm
        /// that was placed in it.
        /// </summary>
        public bool Clear()
        {
            if (_entries.Count == 0)
            {
                return false;
            }
            _entries.Clear();
            return true;
        }

        /// <summary>
        /// Advance to <paramref name="nowUt"/> and say what is due.
        ///
        /// <para>A universal time that has gone BACKWARDS is a quickload or a
        /// revert, and everything held was armed in the timeline that was
        /// abandoned. The roster clears itself rather than carrying a latch
        /// across; the empty roster it then publishes is what tells a client to
        /// re-arm, so no separate reset message is needed.</para>
        /// </summary>
        public ScetAlarmTick Evaluate(double nowUt)
        {
            var tick = new ScetAlarmTick();
            if (double.IsNaN(nowUt) || double.IsInfinity(nowUt))
            {
                return tick;
            }

            if (_lastEvaluatedUt.HasValue && nowUt < _lastEvaluatedUt.Value - RewindToleranceSeconds)
            {
                tick.RosterChanged = Clear();
                _lastEvaluatedUt = nowUt;
                return tick;
            }
            _lastEvaluatedUt = nowUt;

            foreach (var entry in _entries)
            {
                if (entry.Alarm.State != ScetAlarmState.Armed)
                {
                    continue;
                }
                var condition = entry.Alarm.Condition;
                if (condition == null || condition.Kind != ScetAlarmConditionKind.Time)
                {
                    continue;
                }

                var lead = condition.LeadSeconds > 0 ? condition.LeadSeconds : 0;
                if (!entry.SteppedDown && nowUt >= condition.Ut - lead)
                {
                    entry.SteppedDown = true;
                    tick.StopWarp = true;
                }

                if (nowUt < condition.Ut)
                {
                    continue;
                }

                entry.Alarm.State = ScetAlarmState.Fired;
                // The instant the warp ACTUALLY halted, not the instant the
                // operator asked for. Under a coarse warp step one tick can
                // land well past the condition, and the difference is a fact
                // about the simulation's own granularity rather than anything
                // observed aboard the craft, so reporting it leaks nothing and
                // reporting the operator's own number instead would be a
                // readout that cannot be checked against anything.
                entry.Alarm.FiredAtUt = nowUt;
                tick.StopWarp = true;
                tick.RosterChanged = true;
                tick.Fired.Add(new ScetAlarmFired
                {
                    Id = entry.Alarm.Id,
                    FiredAtUt = nowUt,
                });
            }

            return tick;
        }

        /// <summary>
        /// The roster as the <c>alarm.scet</c> channel publishes it. A fresh
        /// copy each call: the caller hands it to a publisher that carries it to
        /// another thread, and the entries here keep being mutated.
        /// </summary>
        public List<ScetAlarm> Snapshot()
        {
            var rows = new List<ScetAlarm>(_entries.Count);
            foreach (var entry in _entries)
            {
                var a = entry.Alarm;
                rows.Add(new ScetAlarm
                {
                    Id = a.Id,
                    Name = a.Name,
                    ArmedBy = a.ArmedBy,
                    Subject = a.Subject,
                    Condition = new ScetAlarmCondition
                    {
                        Kind = a.Condition?.Kind ?? ScetAlarmConditionKind.Time,
                        Ut = a.Condition?.Ut ?? 0,
                        LeadSeconds = a.Condition?.LeadSeconds ?? 0,
                    },
                    State = a.State,
                    FiredAtUt = a.FiredAtUt,
                });
            }
            return rows;
        }

        private int IndexOf(string id)
        {
            for (var i = 0; i < _entries.Count; i++)
            {
                if (string.Equals(_entries[i].Alarm.Id, id, StringComparison.Ordinal))
                {
                    return i;
                }
            }
            return -1;
        }

        /// <summary>
        /// Whether re-arming would change nothing an operator or a client could
        /// see. Compared on the fields the roster publishes, so an identical
        /// re-arm on every reconnect does not churn the channel.
        /// </summary>
        private static bool SameAs(ScetAlarm held, ScetAlarm incoming)
        {
            return held.State == ScetAlarmState.Armed
                && string.Equals(held.Name, incoming.Name, StringComparison.Ordinal)
                && string.Equals(held.ArmedBy, incoming.ArmedBy, StringComparison.Ordinal)
                && string.Equals(held.Subject, incoming.Subject, StringComparison.Ordinal)
                && held.Condition != null
                && held.Condition.Kind == incoming.Condition.Kind
                && held.Condition.Ut == incoming.Condition.Ut
                && held.Condition.LeadSeconds == incoming.Condition.LeadSeconds;
        }
    }
}
