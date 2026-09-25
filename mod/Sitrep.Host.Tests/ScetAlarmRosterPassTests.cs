using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// One roster, one tick, a pass per place its alarms read.
    ///
    /// <para>The split exists because the two readers live on different threads:
    /// the simulation's own state is this tick's snapshot, taken on the Unity
    /// main thread, and what somewhere else has been told is the archive, read on
    /// the Courier. What these cases are about is that splitting the tick does
    /// not split anything that belongs to the tick as a whole.</para>
    /// </summary>
    public class ScetAlarmRosterPassTests
    {
        private const string Craft = "vessel:abc";
        private const string Centre = "ground:Kerbal Space Center";

        private sealed class FakeReader : IScetStateReader
        {
            public ScetReading Next = ScetReading.NotObservable;
            public readonly List<string> Asked = new List<string>();

            public IDictionary<string, object?>? ReadPayload(string subject, string topic) => null;

            public ScetReading Read(string subject, string topic, string fieldPath)
            {
                Asked.Add(subject + "|" + topic + "|" + fieldPath);
                return Next;
            }
        }

        private static ScetAlarmArmArgs Threshold(string id, string vantage) =>
            new ScetAlarmArmArgs
            {
                Id = id,
                Vantage = vantage,
                Subject = Craft,
                Condition = new ScetAlarmCondition
                {
                    Kind = ScetAlarmConditionKind.Threshold,
                    Topic = "vessel.flight",
                    FieldPath = id,
                    Op = ScetAlarmThresholdOp.GreaterThan,
                    Threshold = 100_000,
                },
            };

        private static ScetAlarmArmArgs Time(string id, string vantage, double ut) =>
            new ScetAlarmArmArgs
            {
                Id = id,
                Vantage = vantage,
                Subject = "game",
                Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.Time, Ut = ut },
            };

        private static ScetAlarmRoster RosterWith(params ScetAlarmArmArgs[] alarms)
        {
            var roster = new ScetAlarmRoster();
            foreach (var alarm in alarms)
            {
                roster.Arm(alarm, "ksc");
            }
            return roster;
        }

        private static List<string> FiredIds(ScetAlarmTick tick) =>
            tick.Fired.Select(notice => notice.Id ?? "").OrderBy(id => id).ToList();

        /// <summary>
        /// A pass is asked about its own entries and no others, which is what
        /// keeps a main-thread reader off an alarm whose state lives in the
        /// Courier's archive.
        /// </summary>
        [Fact]
        public void EachPassIsAskedAboutOnlyItsOwnEntries()
        {
            var roster = RosterWith(Threshold("own", Craft), Threshold("away", Centre));
            var mine = new FakeReader();
            var theirs = new FakeReader();

            var tick = roster.BeginTick(1000);
            roster.EvaluatePass(tick, ScetAlarmVantage.IsTheSubjectsOwn, _ => mine);
            roster.EvaluatePass(tick, a => !ScetAlarmVantage.IsTheSubjectsOwn(a), _ => theirs);
            roster.EndTick(tick);

            Assert.Equal(new[] { "vessel:abc|vessel.flight|own" }, mine.Asked);
            Assert.Equal(new[] { "vessel:abc|vessel.flight|away" }, theirs.Asked);
        }

        /// <summary>
        /// Every pass in a tick shares one universal time, so a time condition
        /// comes due on the same tick whichever pass takes it. That is what makes
        /// a time alarm fire at the time itself, the same instant at every
        /// vantage.
        /// </summary>
        [Fact]
        public void ATimeAlarmComesDueOnTheSameTickWhicheverPassTakesIt()
        {
            var roster = RosterWith(Time("own", "", 500), Time("away", Centre, 500));

            var tick = roster.BeginTick(500);
            roster.EvaluatePass(tick, ScetAlarmVantage.IsTheSubjectsOwn, null);
            roster.EvaluatePass(tick, a => !ScetAlarmVantage.IsTheSubjectsOwn(a), null);

            Assert.Equal(new[] { "away", "own" }, FiredIds(roster.EndTick(tick)));
        }

        /// <summary>
        /// The rewind clear is the tick's, not a pass's: it happens once, before
        /// any reading, and no pass afterwards has anything left to evaluate. Two
        /// passes each clearing would be two chances to drop an arm that landed
        /// between them.
        /// </summary>
        [Fact]
        public void ARewindClearsOnceAndEveryPassThenHasNothingToDo()
        {
            var roster = RosterWith(Threshold("own", Craft), Threshold("away", Centre));
            roster.Evaluate(1000, new FakeReader());
            var reader = new FakeReader { Next = ScetReading.Observed(101_000) };

            var tick = roster.BeginTick(10);
            roster.EvaluatePass(tick, ScetAlarmVantage.IsTheSubjectsOwn, _ => reader);
            roster.EvaluatePass(tick, a => !ScetAlarmVantage.IsTheSubjectsOwn(a), _ => reader);
            var result = roster.EndTick(tick);

            Assert.Equal(0, roster.Count);
            Assert.Empty(result.Fired);
            Assert.Empty(reader.Asked);
            Assert.True(result.RosterChanged);
        }

        /// <summary>
        /// An arm that landed off-tick is a change exactly once, over the tick
        /// rather than over each pass, so a roster split two ways does not report
        /// one arm twice or lose it on the second tick.
        /// </summary>
        [Fact]
        public void AnOffTickArmIsReportedOnceOverTheWholeTick()
        {
            var roster = RosterWith(Threshold("own", Craft), Threshold("away", Centre));

            var first = roster.BeginTick(1000);
            roster.EvaluatePass(first, ScetAlarmVantage.IsTheSubjectsOwn, null);
            roster.EvaluatePass(first, a => !ScetAlarmVantage.IsTheSubjectsOwn(a), null);
            Assert.True(roster.EndTick(first).RosterChanged);

            var second = roster.BeginTick(1001);
            roster.EvaluatePass(second, ScetAlarmVantage.IsTheSubjectsOwn, null);
            roster.EvaluatePass(second, a => !ScetAlarmVantage.IsTheSubjectsOwn(a), null);
            Assert.False(roster.EndTick(second).RosterChanged);
        }

        /// <summary>
        /// An entry no pass claims is not evaluated at all, and the posture for an
        /// alarm that was not evaluated is the one every unreadable alarm takes:
        /// it does not fire.
        /// </summary>
        [Fact]
        public void AnEntryNoPassClaimsIsLeftAlone()
        {
            var roster = RosterWith(Threshold("away", Centre));
            var reader = new FakeReader { Next = ScetReading.Observed(101_000) };

            var tick = roster.BeginTick(1000);
            roster.EvaluatePass(tick, ScetAlarmVantage.IsTheSubjectsOwn, _ => reader);
            var result = roster.EndTick(tick);

            Assert.Empty(result.Fired);
            Assert.Empty(reader.Asked);
            Assert.Equal(ScetAlarmState.Armed, Assert.Single(roster.Snapshot()).State);
        }

        /// <summary>
        /// The pass that holds the actuator reads what has asked for the warp so
        /// far, before the other pass has run. Anything a later pass adds is not
        /// the simulation's business, which is what keeps a light-time-old
        /// reading from halting the game for everybody.
        /// </summary>
        [Fact]
        public void TheStopIsReadableBetweenPasses()
        {
            var roster = RosterWith(Threshold("own", Craft), Threshold("away", Centre));
            var reader = new FakeReader { Next = ScetReading.Observed(101_000) };

            var tick = roster.BeginTick(1000);
            Assert.False(tick.StopWarp);

            roster.EvaluatePass(tick, ScetAlarmVantage.IsTheSubjectsOwn, _ => reader);
            Assert.True(tick.StopWarp);

            roster.EvaluatePass(tick, a => !ScetAlarmVantage.IsTheSubjectsOwn(a), _ => reader);
            Assert.Equal(new[] { "away", "own" }, FiredIds(roster.EndTick(tick)));
        }
    }
}
