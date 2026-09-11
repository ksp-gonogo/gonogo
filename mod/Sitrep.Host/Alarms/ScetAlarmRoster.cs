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
    /// KSP-free, clock-free and reading-free: it is told the universal time and
    /// told what the craft's instruments say, and answers what should happen, so
    /// the whole arm can be exercised headlessly.
    ///
    /// <para>A SCET alarm is evaluated against the game's OWN clock and the
    /// game's own state, upstream of the reveal gate, which is the entire point
    /// of it. A client cannot do either for itself. For a TIME condition it
    /// holds the clock but not the geometry: the light time moves continuously,
    /// so subtracting it once at the moment the operator clicks is right for
    /// that instant and wrong by however much the geometry drifted by the time
    /// the alarm was due. For a THRESHOLD it does not hold the number at all,
    /// only a copy of it one light-time old, which is not an answer to "is it
    /// above 100 km now".</para>
    ///
    /// <para>Two instants per alarm either way, mirroring what the client's own
    /// alarm state machine does on its own clock. A time alarm stops the warp at
    /// <c>ut - leadSeconds</c> and fires at <c>ut</c>; a threshold stops it on
    /// the first reading that matches and fires once the condition has held for
    /// its sustain window. Both stops are LATCHED rather than level-tested, so
    /// one warp step that jumps clean over both instants does both, once, on the
    /// tick it lands, and a condition that keeps holding cannot command the warp
    /// down again on every tick after.</para>
    ///
    /// <para><b>What is decided here never reaches the wire.</b> The notice
    /// carries an id and an instant. The reading that caused it does not: the
    /// stop crosses light-time because warp is a property of the simulation, and
    /// the telemetry stays where it was.</para>
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

            /// <summary>
            /// Threshold only: the universal time the condition most recently
            /// STARTED holding, or null while it does not hold. The sustain
            /// window is measured from here, so a condition that lapses and
            /// comes back starts its window again rather than banking the time
            /// it was false for.
            /// </summary>
            public double? MatchSinceUt;
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
                Condition = Copy(condition),
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
        /// Advance to <paramref name="nowUt"/> and say what is due, reading any
        /// threshold conditions through <paramref name="state"/>.
        ///
        /// <para>A universal time that has gone BACKWARDS is a quickload or a
        /// revert, and everything held was armed in the timeline that was
        /// abandoned. The roster clears itself rather than carrying a latch
        /// across; the empty roster it then publishes is what tells a client to
        /// re-arm, so no separate reset message is needed.</para>
        ///
        /// <para><paramref name="state"/> is optional and its absence is not an
        /// error: a tick with no snapshot to read has nothing to say about any
        /// threshold, and a roster holding only time alarms never asks. The
        /// posture either way is that an alarm which cannot be evaluated does
        /// not fire.</para>
        /// </summary>
        public ScetAlarmTick Evaluate(double nowUt, IScetStateReader? state = null)
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
                if (condition == null)
                {
                    continue;
                }

                switch (condition.Kind)
                {
                    case ScetAlarmConditionKind.Time:
                        EvaluateTime(entry, condition, nowUt, tick);
                        break;
                    case ScetAlarmConditionKind.Threshold:
                        EvaluateThreshold(entry, condition, nowUt, tick, state);
                        break;
                }
            }

            return tick;
        }

        private static void EvaluateTime(
            Entry entry, ScetAlarmCondition condition, double nowUt, ScetAlarmTick tick)
        {
            var lead = condition.LeadSeconds > 0 ? condition.LeadSeconds : 0;
            if (!entry.SteppedDown && nowUt >= condition.Ut - lead)
            {
                entry.SteppedDown = true;
                tick.StopWarp = true;
            }

            if (nowUt < condition.Ut)
            {
                return;
            }
            Fire(entry, nowUt, tick);
        }

        /// <summary>
        /// One threshold against one reading of the craft's TRUE state, taken
        /// upstream of the reveal gate.
        ///
        /// <para>Two instants again, as the time arm has: the warp stops on the
        /// first reading that matches, and the alarm fires once the condition
        /// has held for its sustain window. The order is not an optimisation. A
        /// sustain window is a span of the craft's own time, and one warped tick
        /// covers thousands of seconds of it, so a window that was only ever
        /// sampled twice would be "sustained" on no evidence. Stopping first is
        /// what buys the window real ticks to be measured over.</para>
        /// </summary>
        private static void EvaluateThreshold(
            Entry entry,
            ScetAlarmCondition condition,
            double nowUt,
            ScetAlarmTick tick,
            IScetStateReader? state)
        {
            if (state == null)
            {
                return;
            }

            var reading = state.Read(
                entry.Alarm.Subject ?? "", condition.Topic ?? "", condition.FieldPath ?? "");

            if (reading.Status == ScetReadingStatus.SubjectGone)
            {
                // The craft is not coming back, so neither is the condition. Said
                // on the roster rather than left pending forever, because the
                // simulation knows this and the command centre cannot.
                entry.Alarm.State = ScetAlarmState.Unreachable;
                entry.MatchSinceUt = null;
                tick.RosterChanged = true;
                return;
            }

            if (reading.Status != ScetReadingStatus.Observed)
            {
                return;
            }

            if (!Matches(reading.Value, condition.Op, condition.Threshold))
            {
                entry.MatchSinceUt = null;
                return;
            }

            if (!entry.SteppedDown)
            {
                entry.SteppedDown = true;
                tick.StopWarp = true;
            }

            entry.MatchSinceUt ??= nowUt;
            var sustain = condition.SustainSeconds > 0 ? condition.SustainSeconds : 0;
            if (nowUt - entry.MatchSinceUt.Value < sustain)
            {
                return;
            }

            Fire(entry, nowUt, tick);
        }

        private static bool Matches(double reading, ScetAlarmThresholdOp op, double threshold)
        {
            switch (op)
            {
                case ScetAlarmThresholdOp.GreaterThan: return reading > threshold;
                case ScetAlarmThresholdOp.GreaterThanOrEqual: return reading >= threshold;
                case ScetAlarmThresholdOp.LessThan: return reading < threshold;
                case ScetAlarmThresholdOp.LessThanOrEqual: return reading <= threshold;
                case ScetAlarmThresholdOp.Equal: return reading == threshold;
                case ScetAlarmThresholdOp.NotEqual: return reading != threshold;
                default: return false;
            }
        }

        /// <summary>
        /// Latch one alarm and queue its notice.
        ///
        /// <para>The instant recorded is the one the clock ACTUALLY reached, not
        /// the one the operator asked for. Under a coarse warp step a tick can
        /// land well past either kind of condition, and the difference is a fact
        /// about the simulation's own granularity rather than anything observed
        /// aboard the craft, so reporting it leaks nothing and reporting the
        /// operator's own number instead would be a readout that cannot be
        /// checked against anything.</para>
        ///
        /// <para>The notice says which alarm and when, and nothing else. For a
        /// threshold that is the whole point: the measured value is the one
        /// thing that must not travel early, because "altitude passed 100 km" is
        /// a claim about the craft wearing the operator's own words.</para>
        /// </summary>
        private static void Fire(Entry entry, double nowUt, ScetAlarmTick tick)
        {
            entry.Alarm.State = ScetAlarmState.Fired;
            entry.Alarm.FiredAtUt = nowUt;
            tick.StopWarp = true;
            tick.RosterChanged = true;
            tick.Fired.Add(new ScetAlarmFired
            {
                Id = entry.Alarm.Id,
                FiredAtUt = nowUt,
            });
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
                    Condition = Copy(a.Condition),
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
                && held.Condition.LeadSeconds == incoming.Condition.LeadSeconds
                && string.Equals(held.Condition.Topic, incoming.Condition.Topic, StringComparison.Ordinal)
                && string.Equals(held.Condition.FieldPath, incoming.Condition.FieldPath, StringComparison.Ordinal)
                && held.Condition.Op == incoming.Condition.Op
                && held.Condition.Threshold == incoming.Condition.Threshold
                && held.Condition.SustainSeconds == incoming.Condition.SustainSeconds;
        }

        /// <summary>
        /// A condition detached from whoever handed it over. Both directions
        /// need one: an incoming arm must not stay reachable by the caller that
        /// sent it, and a published snapshot must not expose the live entry a
        /// later tick will mutate.
        /// </summary>
        private static ScetAlarmCondition Copy(ScetAlarmCondition? c)
        {
            if (c == null)
            {
                return new ScetAlarmCondition();
            }
            return new ScetAlarmCondition
            {
                Kind = c.Kind,
                Ut = c.Ut,
                LeadSeconds = c.LeadSeconds,
                Topic = c.Topic ?? "",
                FieldPath = c.FieldPath ?? "",
                Op = c.Op,
                Threshold = c.Threshold,
                SustainSeconds = c.SustainSeconds,
            };
        }
    }
}
