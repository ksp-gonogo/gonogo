using System;
using System.Collections.Generic;
using System.Linq;

namespace Sitrep.Core.StoreAndForward
{
    /// <summary>What the craft does with two held values of the same control channel on one lane when it releases them.</summary>
    public enum ControlValueRelease
    {
        /// <summary>Every value runs, in lane order.</summary>
        RunEvery,

        /// <summary>An older value is discarded when a newer value of the same channel is held beside it.</summary>
        LatestWins,

        /// <summary>
        /// Each command runs no sooner than the one before it plus the gap between
        /// their sends, so a span held and released together replays with its
        /// original spacing, shifted by the wait. Unheld traffic runs exactly as
        /// it arrives, which is the same thing.
        /// </summary>
        TimeShifted,
    }

    /// <summary>
    /// The craft's half of a lane: runs each arriving command in lane order,
    /// holds a command that arrives ahead of an earlier number, and settles every
    /// number exactly once.
    ///
    /// <para>On each arrival: a number already settled is discarded; the next
    /// number runs, and every held successor now in sequence runs after it; a
    /// later number waits until every missing predecessor has arrived or been
    /// cancelled, or until its gap expiry passes, when the missing numbers are
    /// counted lost and the lane moves past them. A cancel marks the numbers it
    /// names for the rest of the timeline, so a cancelled number never runs
    /// whenever it arrives.</para>
    /// </summary>
    public sealed class LaneCollector
    {
        private readonly SortedDictionary<long, CommandMessage> _waiting = new SortedDictionary<long, CommandMessage>();
        private readonly HashSet<long> _cancelled = new HashSet<long>();
        private readonly HashSet<long> _expired = new HashSet<long>();
        private readonly Dictionary<long, double> _ran = new Dictionary<long, double>();
        private readonly SortedDictionary<long, (CommandMessage Command, double AtUt, Action? Cancel)> _scheduled =
            new SortedDictionary<long, (CommandMessage, double, Action?)>();
        private readonly Func<double, Action, Action>? _schedule;
        private double _lastRunUt = double.NaN;
        private double _lastSentUt = double.NaN;
        private readonly Func<CommandMessage, double, object?> _execute;
        private readonly Action<ReportMessage> _report;
        private readonly ControlValueRelease _release;

        /// <param name="execute">Runs a command on the craft at the given instant and returns its result.</param>
        /// <param name="report">Takes each report the craft sends back.</param>
        /// <param name="release">How held commands are released.</param>
        /// <param name="schedule">Schedules a run for a later instant and returns its cancel; needed for <see cref="ControlValueRelease.TimeShifted"/>.</param>
        public LaneCollector(
            LaneKey lane,
            Func<CommandMessage, double, object?> execute,
            Action<ReportMessage> report,
            ControlValueRelease release = ControlValueRelease.RunEvery,
            Func<double, Action, Action>? schedule = null)
        {
            _schedule = schedule;
            Lane = lane;
            _execute = execute ?? throw new ArgumentNullException(nameof(execute));
            _report = report ?? throw new ArgumentNullException(nameof(report));
            _release = release;
        }

        public LaneKey Lane { get; }

        /// <summary>The next lane number to run.</summary>
        public long Next { get; private set; } = 1;

        /// <summary>The commands waiting behind a gap, by lane number.</summary>
        public IReadOnlyDictionary<long, CommandMessage> Waiting => _waiting;

        /// <summary>The numbers a cancel has marked.</summary>
        public IReadOnlyCollection<long> Cancelled => _cancelled;

        /// <summary>A command has arrived at the craft at <paramref name="nowUt"/>.</summary>
        public void Arrive(CommandMessage command, double nowUt)
        {
            foreach (var settled in command.Supersedes)
            {
                if (!_ran.ContainsKey(settled) && !_waiting.ContainsKey(settled))
                {
                    _expired.Add(settled);
                }
            }
            if (nowUt > command.DeleteAtUt)
            {
                Report(command, JourneyKind.Expired, nowUt);
                Drain(nowUt);
                return;
            }
            if (_ran.ContainsKey(command.LaneSeq))
            {
                Report(command, JourneyKind.Discarded, nowUt, detail: "a copy already ran");
                return;
            }
            if (_cancelled.Contains(command.LaneSeq))
            {
                Report(command, JourneyKind.Discarded, nowUt, detail: "cancelled");
                return;
            }
            if (command.LaneSeq < Next)
            {
                Report(command, JourneyKind.Discarded, nowUt, detail: "its lane moved on");
                return;
            }
            if (_waiting.ContainsKey(command.LaneSeq) || _scheduled.ContainsKey(command.LaneSeq))
            {
                Report(command, JourneyKind.Discarded, nowUt, detail: "a copy is already waiting");
                return;
            }

            _waiting[command.LaneSeq] = command;
            Drain(nowUt);
            if (_waiting.ContainsKey(command.LaneSeq))
            {
                var missing = Missing(command.LaneSeq);
                _report(new ReportMessage
                {
                    Kind = JourneyKind.Waiting,
                    About = command.Id,
                    Lane = Lane,
                    LaneSeq = command.LaneSeq,
                    To = Lane.Vantage,
                    At = Lane.Craft,
                    AtUt = nowUt,
                    Missing = missing,
                });
                if (command.GapExpiresUt == null || command.GapExpiresUt.Value <= nowUt)
                {
                    ReleaseGap(nowUt);
                }
            }
        }

        /// <summary>A cancel has arrived at the craft at <paramref name="nowUt"/>.</summary>
        public void Cancel(CancelMessage cancel, double nowUt)
        {
            for (var seq = cancel.FromSeq; seq <= cancel.ThroughSeq; seq++)
            {
                if (_ran.TryGetValue(seq, out var ranUt))
                {
                    ReportCancel(cancel, seq, JourneyKind.CancelLate, nowUt, ranUt);
                    continue;
                }
                if (seq < Next || _expired.Contains(seq))
                {
                    // Settled without running: expired, lost to a gap, or already cancelled.
                    continue;
                }
                if (_scheduled.TryGetValue(seq, out var due))
                {
                    _scheduled.Remove(seq);
                    due.Cancel?.Invoke();
                    _cancelled.Add(seq);
                    Report(due.Command, JourneyKind.Cancelled, nowUt);
                    continue;
                }
                if (_waiting.TryGetValue(seq, out var waiting))
                {
                    _waiting.Remove(seq);
                    _cancelled.Add(seq);
                    Report(waiting, JourneyKind.Cancelled, nowUt);
                    continue;
                }
                if (_cancelled.Add(seq))
                {
                    ReportCancel(cancel, seq, JourneyKind.CancelStored, nowUt, null);
                }
            }
            Drain(nowUt);
        }

        /// <summary>Releases gaps whose expiry has passed and expires commands held past their own lifetime.</summary>
        public void Tick(double nowUt)
        {
            foreach (var expired in _waiting.Values.Where(c => nowUt > c.DeleteAtUt).ToList())
            {
                _waiting.Remove(expired.LaneSeq);
                Report(expired, JourneyKind.Expired, nowUt);
                // Its number is settled: the sender counts it dead at the same instant.
                _expired.Add(expired.LaneSeq);
            }
            if (_waiting.Count > 0)
            {
                var first = _waiting.First().Value;
                if (first.LaneSeq > Next && (first.GapExpiresUt == null || first.GapExpiresUt.Value <= nowUt))
                {
                    ReleaseGap(nowUt);
                }
            }
            Drain(nowUt);
        }

        /// <summary>Restores the lane's state from a save.</summary>
        public void Restore(
            long next,
            IEnumerable<long> cancelled,
            IEnumerable<KeyValuePair<long, double>> ran,
            IEnumerable<CommandMessage> waiting,
            IEnumerable<long>? expired = null,
            IEnumerable<(CommandMessage Command, double AtUt)>? scheduled = null,
            (double RunUt, double SentUt)? cadence = null)
        {
            Next = Math.Max(1, next);
            _cancelled.Clear();
            _cancelled.UnionWith(cancelled);
            _expired.Clear();
            if (expired != null)
            {
                _expired.UnionWith(expired);
            }
            if (cadence != null)
            {
                _lastRunUt = cadence.Value.RunUt;
                _lastSentUt = cadence.Value.SentUt;
            }
            foreach (var due in scheduled ?? Enumerable.Empty<(CommandMessage, double)>())
            {
                Schedule(due.Item1, due.Item2);
            }
            _ran.Clear();
            foreach (var entry in ran)
            {
                _ran[entry.Key] = entry.Value;
            }
            _waiting.Clear();
            foreach (var command in waiting)
            {
                _waiting[command.LaneSeq] = command;
            }
        }

        /// <summary>The numbers that ran, and when, for saving with the game.</summary>
        public IReadOnlyDictionary<long, double> Ran => _ran;

        /// <summary>
        /// The lane moves past every missing number below the first waiting one:
        /// their gap expiry has passed, so no copy of them can still arrive.
        /// </summary>
        private void ReleaseGap(double nowUt)
        {
            if (_waiting.Count == 0)
            {
                return;
            }
            Next = _waiting.First().Key;
            Drain(nowUt);
        }

        private void Drain(double nowUt)
        {
            while (true)
            {
                if (_cancelled.Contains(Next) || _expired.Contains(Next))
                {
                    Next++;
                    continue;
                }
                if (!_waiting.TryGetValue(Next, out var command))
                {
                    return;
                }
                _waiting.Remove(Next);
                Next++;
                if (_release == ControlValueRelease.LatestWins && Superseded(command))
                {
                    Report(command, JourneyKind.Discarded, nowUt, detail: "superseded by a later " + command.Channel + " value");
                    continue;
                }
                RunOrSchedule(command, nowUt);
            }
        }

        /// <summary>Runs a command now, or, under time-shifted release, at its place in the replayed span.</summary>
        private void RunOrSchedule(CommandMessage command, double nowUt)
        {
            var at = nowUt;
            if (_release == ControlValueRelease.TimeShifted && !double.IsNaN(_lastRunUt))
            {
                at = Math.Max(nowUt, _lastRunUt + Math.Max(0.0, command.SentUt - _lastSentUt));
            }
            _lastRunUt = at;
            _lastSentUt = command.SentUt;
            if (at <= nowUt + 1e-9 || _schedule == null)
            {
                Run(command, nowUt);
                return;
            }
            Schedule(command, at);
        }

        private void Schedule(CommandMessage command, double atUt)
        {
            var seq = command.LaneSeq;
            var cancel = _schedule!(atUt, () =>
            {
                if (_scheduled.Remove(seq))
                {
                    Run(command, atUt);
                }
            });
            _scheduled[seq] = (command, atUt, cancel);
        }

        private void Run(CommandMessage command, double atUt)
        {
            var result = _execute(command, atUt);
            _ran[command.LaneSeq] = atUt;
            _report(new ReportMessage
            {
                Kind = JourneyKind.Reply,
                About = command.Id,
                Lane = Lane,
                LaneSeq = command.LaneSeq,
                To = Lane.Vantage,
                At = Lane.Craft,
                AtUt = atUt,
                Result = result,
                ClientRequestId = command.ClientRequestId,
                Command = command.Command,
            });
        }

        /// <summary>The commands due to run later in a replayed span, and when.</summary>
        public IReadOnlyList<(CommandMessage Command, double AtUt)> Scheduled =>
            _scheduled.Values.Select(v => (v.Command, v.AtUt)).ToList();

        /// <summary>The numbers that expired at the craft, for saving with the game.</summary>
        public IReadOnlyCollection<long> Expired => _expired;

        /// <summary>When the last command ran or is due to, and when it was sent: where a replayed span picks up.</summary>
        public (double RunUt, double SentUt) Cadence => (_lastRunUt, _lastSentUt);

        /// <summary>Whether a later value of the same control channel is already waiting behind this one.</summary>
        private bool Superseded(CommandMessage command)
        {
            if (command.Channel == null)
            {
                return false;
            }
            foreach (var later in _waiting.Values)
            {
                if (later.LaneSeq > command.LaneSeq && string.Equals(later.Channel, command.Channel, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        private List<long> Missing(long seq)
        {
            var missing = new List<long>();
            for (var n = Next; n < seq; n++)
            {
                if (!_cancelled.Contains(n) && !_expired.Contains(n) && !_waiting.ContainsKey(n))
                {
                    missing.Add(n);
                }
            }
            return missing;
        }

        private void Report(CommandMessage command, JourneyKind kind, double nowUt, string? detail = null)
        {
            _report(new ReportMessage
            {
                Kind = kind,
                About = command.Id,
                Lane = Lane,
                LaneSeq = command.LaneSeq,
                To = Lane.Vantage,
                At = Lane.Craft,
                AtUt = nowUt,
                Detail = detail,
                ClientRequestId = command.ClientRequestId,
                Command = command.Command,
            });
        }

        private void ReportCancel(CancelMessage cancel, long seq, JourneyKind kind, double nowUt, double? ranUt)
        {
            _report(new ReportMessage
            {
                Kind = kind,
                About = cancel.Id,
                Lane = Lane,
                LaneSeq = seq,
                To = Lane.Vantage,
                At = Lane.Craft,
                AtUt = nowUt,
                UntilUt = ranUt,
            });
        }
    }
}
