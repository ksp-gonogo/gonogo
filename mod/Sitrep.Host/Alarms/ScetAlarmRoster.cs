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

        /// <summary>
        /// Whether <see cref="ScetAlarmRoster.Snapshot"/> would now differ from
        /// the last one published. Covers what this evaluation decided AND any
        /// arm or disarm that landed off-tick since the last one, which is the
        /// only way a tick can learn about a command handler's work.
        /// </summary>
        public bool RosterChanged { get; set; }
    }

    /// <summary>
    /// One tick in progress, between <see cref="ScetAlarmRoster.BeginTick"/> and
    /// <see cref="ScetAlarmRoster.EndTick"/>.
    ///
    /// <para>It exists because a tick is evaluated in more than one PASS, on more
    /// than one thread: the entries read off the simulation's own state are
    /// evaluated on the Unity main thread, the rest off the archive on the
    /// Courier. What is genuinely once-per-tick, the rewind clear and the
    /// off-tick change flag, happens in <c>BeginTick</c> and is carried here, so
    /// a second pass cannot do it again.</para>
    /// </summary>
    public sealed class ScetAlarmTickState
    {
        internal readonly double NowUt;

        /// <summary>
        /// Whether a pass may read anything at all. A non-finite clock and a
        /// rewind both END the tick where they are found: there is nothing to
        /// evaluate against a clock that is not a number, and everything held
        /// across a rewind was armed in a timeline that no longer exists.
        /// </summary>
        internal readonly bool Live;

        internal readonly ScetAlarmTick Tick;

        internal ScetAlarmTickState(double nowUt, bool live, ScetAlarmTick tick)
        {
            NowUt = nowUt;
            Live = live;
            Tick = tick;
        }

        /// <summary>
        /// Whether anything has asked for the warp to stop so far this tick.
        /// Read between passes, by the one that holds the actuator.
        /// </summary>
        public bool StopWarp => Tick.StopWarp;
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
    /// warp stops where the alarm came due, and the telemetry stays where it
    /// was.</para>
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

        /// <summary>
        /// Whether an <see cref="Arm"/> or a <see cref="Disarm"/> has moved the
        /// roster since the last <see cref="Evaluate"/> reported on it.
        ///
        /// <para>Those two are the only mutations that arrive from OUTSIDE a
        /// tick: they come off a command handler, and the tick that follows has
        /// no other way to know anything happened. Everything else that changes
        /// the roster (a fire, a rewind, an alarm going unreachable) is decided
        /// inside <see cref="Evaluate"/> and says so on the tick it decides.
        /// Without this an operator's arm reached the host and stayed invisible
        /// until some LATER alarm fired and republished the roster on its
        /// way.</para>
        /// </summary>
        private bool _pendingChange;

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
                // Taken from the arguments, unlike ArmedBy: an operator at one
                // centre may ask when another centre will know. Resolved HERE
                // rather than left empty for a reader to interpret, so the
                // roster a client reconciles against says where each alarm is
                // read and nowhere has to work it out twice.
                Vantage = ScetAlarmVantage.Of(args),
                Subject = ScetAlarmVantage.SubjectOf(args),
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
                _pendingChange = true;
                return true;
            }

            _entries.Add(new Entry { Alarm = alarm });
            _pendingChange = true;
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
            _pendingChange = true;
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
        /// Advance to <paramref name="nowUt"/> and say what is due, reading EVERY
        /// threshold condition through the one reader <paramref name="state"/>.
        ///
        /// <para>The whole-roster form of <see cref="BeginTick"/>,
        /// <see cref="EvaluatePass"/> and <see cref="EndTick"/>, for a caller
        /// whose entries all read from the same place. A caller whose entries
        /// read from different places, and therefore on different threads, uses
        /// the three.</para>
        /// </summary>
        public ScetAlarmTick Evaluate(double nowUt, IScetStateReader? state = null)
        {
            var tick = BeginTick(nowUt);
            EvaluatePass(tick, null, _ => state);
            return EndTick(tick);
        }

        /// <summary>
        /// Open a tick at <paramref name="nowUt"/>: the once-per-tick decisions,
        /// taken before any reading.
        ///
        /// <para>Two of them, and they are once-per-tick in the strong sense that
        /// doing them twice would be wrong rather than merely wasteful. The
        /// off-tick change flag is reported exactly once, on whichever tick comes
        /// first, including one that cannot evaluate at all, or a clock that went
        /// briefly non-finite would eat the operator's arm. And a clock that has
        /// gone BACKWARDS is a quickload or a revert: everything held was armed
        /// in the timeline that was abandoned, so the roster clears itself rather
        /// than carrying a latch across, and the empty roster it then publishes
        /// is what tells a client to re-arm.</para>
        /// </summary>
        public ScetAlarmTickState BeginTick(double nowUt)
        {
            var tick = new ScetAlarmTick { RosterChanged = _pendingChange };
            _pendingChange = false;

            if (double.IsNaN(nowUt) || double.IsInfinity(nowUt))
            {
                return new ScetAlarmTickState(nowUt, live: false, tick);
            }

            if (_lastEvaluatedUt.HasValue && nowUt < _lastEvaluatedUt.Value - RewindToleranceSeconds)
            {
                tick.RosterChanged |= Clear();
                _lastEvaluatedUt = nowUt;
                return new ScetAlarmTickState(nowUt, live: false, tick);
            }
            _lastEvaluatedUt = nowUt;

            return new ScetAlarmTickState(nowUt, live: true, tick);
        }

        /// <summary>
        /// Evaluate the entries <paramref name="mine"/> accepts, reading each
        /// through the reader <paramref name="readerFor"/> gives it. A null
        /// <paramref name="mine"/> takes every entry.
        ///
        /// <para>Callable more than once per tick, and meant to be: an entry read
        /// off the simulation's own state must be evaluated on the Unity main
        /// thread and one read off the archive on the Courier, so the tick is
        /// split by WHERE each alarm reads rather than by holding a roster
        /// each. Every pass in a tick shares one <see cref="ScetAlarmTickState"/>
        /// and therefore one universal time, which is why a time condition comes
        /// due on the same tick at every vantage.</para>
        ///
        /// <para><paramref name="readerFor"/> may answer null, and its absence is
        /// not an error: a tick with no snapshot to read has nothing to say about
        /// any threshold, and a pass over nothing but time alarms never asks. The
        /// posture either way is that an alarm which cannot be evaluated does not
        /// fire.</para>
        /// </summary>
        public void EvaluatePass(
            ScetAlarmTickState? state,
            Func<ScetAlarm, bool>? mine,
            Func<ScetAlarm, IScetStateReader?>? readerFor)
        {
            if (state == null || !state.Live)
            {
                return;
            }

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
                if (mine != null && !mine(entry.Alarm))
                {
                    continue;
                }

                switch (condition.Kind)
                {
                    case ScetAlarmConditionKind.Time:
                        EvaluateTime(entry, condition, state.NowUt, state.Tick);
                        break;
                    case ScetAlarmConditionKind.Threshold:
                        EvaluateThreshold(
                            entry,
                            condition,
                            state.NowUt,
                            state.Tick,
                            readerFor == null ? null : readerFor(entry.Alarm));
                        break;
                }
            }
        }

        /// <summary>Close the tick and answer what it decided, over every pass.</summary>
        public ScetAlarmTick EndTick(ScetAlarmTickState state) => state.Tick;

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
                // Echoed so a reader can tell which place learned it without
                // consulting the roster. A notice at the subject's own vantage
                // is the one the warp stopped for.
                Vantage = entry.Alarm.Vantage ?? "",
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
                    Vantage = a.Vantage,
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
                && string.Equals(held.Vantage, incoming.Vantage, StringComparison.Ordinal)
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
