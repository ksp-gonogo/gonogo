using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The SCET alarm arm's decision-making, headlessly: when warp is stopped,
    /// when the notice goes out, and what survives a re-arm or a rewind.
    ///
    /// <para>Every assertion here is about a clock and a reading the roster is
    /// TOLD, never ones it takes, which is what lets the feature be exercised
    /// without a game. The KSP half is <c>Gonogo.KSP.ScetAlarmUplink</c> and is
    /// three calls long by design.</para>
    /// </summary>
    public class ScetAlarmRosterTests
    {
        /// <summary>
        /// A reading the test decides. Stands in for the snapshot read the
        /// uplink does on the main thread, so what is being asserted here is the
        /// DECISION rather than the plumbing that fetches the number.
        /// </summary>
        private sealed class FakeReader : IScetStateReader
        {
            public ScetReading Next = ScetReading.NotObservable;

            /// <summary>Every (subject, topic, path) the roster asked for, in order.</summary>
            public readonly List<string> Asked = new List<string>();

            public ScetReading Read(string subject, string topic, string fieldPath)
            {
                Asked.Add(subject + "|" + topic + "|" + fieldPath);
                return Next;
            }
        }

        private static ScetAlarmArmArgs ThresholdAlarm(
            string id,
            double threshold,
            ScetAlarmThresholdOp op = ScetAlarmThresholdOp.GreaterThan,
            double sustainSeconds = 0,
            string subject = "vessel:abc",
            string topic = "vessel.flight",
            string fieldPath = "altitudeAsl") =>
            new ScetAlarmArmArgs
            {
                Id = id,
                Name = "Alarm",
                Subject = subject,
                Condition = new ScetAlarmCondition
                {
                    Kind = ScetAlarmConditionKind.Threshold,
                    Topic = topic,
                    FieldPath = fieldPath,
                    Op = op,
                    Threshold = threshold,
                    SustainSeconds = sustainSeconds,
                },
            };

        private static ScetAlarmArmArgs TimeAlarm(
            string id, double ut, double leadSeconds = 0, string name = "Alarm") =>
            new ScetAlarmArmArgs
            {
                Id = id,
                Name = name,
                Subject = "game",
                Condition = new ScetAlarmCondition
                {
                    Kind = ScetAlarmConditionKind.Time,
                    Ut = ut,
                    LeadSeconds = leadSeconds,
                },
            };

        [Fact]
        public void ArmingRecordsTheVantageTheCommandCameFrom()
        {
            var roster = new ScetAlarmRoster();

            Assert.True(roster.Arm(TimeAlarm("a", 1000), "ksc"));

            var row = Assert.Single(roster.Snapshot());
            Assert.Equal("a", row.Id);
            Assert.Equal("ksc", row.ArmedBy);
            Assert.Equal("game", row.Subject);
            Assert.Equal(ScetAlarmState.Armed, row.State);
            Assert.Null(row.FiredAtUt);
        }

        [Fact]
        public void ReArmingAnIdenticalAlarmChangesNothing()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");

            // The reconnect case: a client re-arms everything it holds on every
            // connect, and an identical re-arm must not churn the channel.
            Assert.False(roster.Arm(TimeAlarm("a", 1000), "ksc"));
            Assert.Single(roster.Snapshot());
        }

        [Fact]
        public void ReArmingADifferentConditionReplacesInPlace()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");

            Assert.True(roster.Arm(TimeAlarm("a", 2000), "ksc"));

            var row = Assert.Single(roster.Snapshot());
            Assert.Equal(2000, row.Condition.Ut);
        }

        [Fact]
        public void ReArmingAFiredAlarmArmsItAgain()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");
            roster.Evaluate(1000);
            Assert.Equal(ScetAlarmState.Fired, roster.Snapshot()[0].State);

            // The operator moved the instant. The alarm has not fired at the new
            // one, so the latch goes with the condition it belonged to.
            Assert.True(roster.Arm(TimeAlarm("a", 3000), "ksc"));
            var row = Assert.Single(roster.Snapshot());
            Assert.Equal(ScetAlarmState.Armed, row.State);
            Assert.Null(row.FiredAtUt);
        }

        [Fact]
        public void DisarmDropsTheAlarmAndAnUnknownIdIsANoOp()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");

            Assert.False(roster.Disarm("not-held"));
            Assert.True(roster.Disarm("a"));
            Assert.Empty(roster.Snapshot());
        }

        [Fact]
        public void FiresOnceAtTheConditionInstant()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");

            Assert.Empty(roster.Evaluate(999).Fired);

            var firing = roster.Evaluate(1000);
            var notice = Assert.Single(firing.Fired);
            Assert.Equal("a", notice.Id);
            Assert.Equal(1000, notice.FiredAtUt);
            Assert.True(firing.StopWarp);
            Assert.True(firing.RosterChanged);

            // Latched: the condition still holds on the next tick and must not
            // stop the warp again, which is what would make an alarm unescapable.
            var after = roster.Evaluate(1001);
            Assert.Empty(after.Fired);
            Assert.False(after.StopWarp);
        }

        [Fact]
        public void TheNoticeCarriesTheInstantTheClockActuallyReached()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");

            // One coarse warp step lands well past the condition. The honest
            // answer is where the warp actually halted, which is a fact about the
            // simulation's granularity and not about the craft.
            var notice = Assert.Single(roster.Evaluate(1_200).Fired);
            Assert.Equal(1_200, notice.FiredAtUt);
        }

        [Fact]
        public void StopsWarpOnceAtTheLeadInstantAndAgainAtTheFire()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", ut: 1000, leadSeconds: 10), "ksc");

            Assert.False(roster.Evaluate(989).StopWarp);

            // Entering the lead window stops the warp and says nothing else:
            // the operator gets their real seconds in hand before the instant.
            var stepDown = roster.Evaluate(990);
            Assert.True(stepDown.StopWarp);
            Assert.Empty(stepDown.Fired);
            Assert.False(stepDown.RosterChanged);

            // Still inside the window, already stopped: no second command.
            Assert.False(roster.Evaluate(995).StopWarp);

            var firing = roster.Evaluate(1000);
            Assert.True(firing.StopWarp);
            Assert.Single(firing.Fired);
        }

        [Fact]
        public void AWarpStepOverBothInstantsDoesBothOnTheTickItLands()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", ut: 1000, leadSeconds: 10), "ksc");

            // At 100,000x one tick moves the clock by thousands of seconds. A
            // level test on the lead window would step clean over it in silence;
            // the latch is what makes this the tick that owes the operator both.
            var tick = roster.Evaluate(50_000);
            Assert.True(tick.StopWarp);
            Assert.Single(tick.Fired);
        }

        [Fact]
        public void TwoAlarmsComingDueTogetherAreOneStopAndTwoNotices()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");
            roster.Arm(TimeAlarm("b", 1000), "ksc");

            var tick = roster.Evaluate(1000);
            Assert.True(tick.StopWarp);
            Assert.Equal(new[] { "a", "b" }, tick.Fired.Select(f => f.Id).ToArray());
        }

        [Fact]
        public void ABackwardClockClearsEverything()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");
            roster.Evaluate(900);

            // A quickload or a revert. Everything held was armed in a timeline
            // that no longer exists, latches included; the empty roster this
            // publishes is what tells a client to re-arm.
            var tick = roster.Evaluate(500);
            Assert.True(tick.RosterChanged);
            Assert.Empty(roster.Snapshot());
        }

        [Fact]
        public void ASecondOfClockJitterIsNotARewind()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");
            roster.Evaluate(900);

            Assert.False(roster.Evaluate(899.5).RosterChanged);
            Assert.Single(roster.Snapshot());
        }

        [Fact]
        public void TheSnapshotIsACopy()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");

            var first = roster.Snapshot();
            first[0].Name = "mutated";
            first[0].Condition.Ut = 5;

            var second = roster.Snapshot();
            Assert.Equal("Alarm", second[0].Name);
            Assert.Equal(1000, second[0].Condition.Ut);
        }

        [Fact]
        public void ArmingWithoutAnIdIsRefused()
        {
            var roster = new ScetAlarmRoster();
            Assert.False(roster.Arm(new ScetAlarmArmArgs { Id = "" }, "ksc"));
            Assert.False(roster.Arm(null, "ksc"));
            Assert.Empty(roster.Snapshot());
        }

        /// <summary>
        /// A threshold asks for the reading the way the wire addresses it, and
        /// for the craft the operator named rather than whichever one is active.
        /// </summary>
        [Fact]
        public void AThresholdAsksForItsOwnSubjectTopicAndPath()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000), "ksc");
            var reader = new FakeReader();

            roster.Evaluate(1000, reader);

            Assert.Equal(new[] { "vessel:abc|vessel.flight|altitudeAsl" }, reader.Asked.ToArray());
        }

        [Fact]
        public void AThresholdFiresWhenTheReadingCrossesTheOperatorsNumber()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000), "ksc");
            var reader = new FakeReader { Next = ScetReading.Observed(99_000) };

            Assert.Empty(roster.Evaluate(1000, reader).Fired);

            reader.Next = ScetReading.Observed(101_000);
            var firing = roster.Evaluate(1010, reader);

            var notice = Assert.Single(firing.Fired);
            Assert.Equal("a", notice.Id);
            Assert.Equal(1010, notice.FiredAtUt);
            Assert.True(firing.StopWarp);
            Assert.Equal(ScetAlarmState.Fired, roster.Snapshot()[0].State);
        }

        [Fact]
        public void TheNoticeSaysNothingAboutTheReadingThatCausedIt()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000), "ksc");

            // Well past the threshold, because one warp step is enough to carry a
            // craft a long way beyond it. The operator accepted seeing the alarm
            // fire while their readouts still show the craft minutes ago; they did
            // not accept the reason travelling early. The notice has two fields and
            // this is the test that keeps it at two.
            var notice = Assert.Single(
                roster.Evaluate(1000, new FakeReader { Next = ScetReading.Observed(412_345) }).Fired);

            Assert.Equal("a", notice.Id);
            Assert.Equal(1000, notice.FiredAtUt);
            Assert.Equal(
                new[] { "FiredAtUt", "Id" },
                typeof(ScetAlarmFired).GetProperties().Select(p => p.Name).OrderBy(n => n).ToArray());
        }

        [Fact]
        public void AThresholdIsLatchedSoAConditionThatKeepsHoldingCannotStopTheWarpAgain()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000), "ksc");
            var reader = new FakeReader { Next = ScetReading.Observed(101_000) };

            Assert.True(roster.Evaluate(1000, reader).StopWarp);

            var after = roster.Evaluate(1001, reader);
            Assert.False(after.StopWarp);
            Assert.Empty(after.Fired);
        }

        [Theory]
        [InlineData(ScetAlarmThresholdOp.GreaterThan, 100.0, 100.0, false)]
        [InlineData(ScetAlarmThresholdOp.GreaterThan, 100.0, 100.1, true)]
        [InlineData(ScetAlarmThresholdOp.GreaterThanOrEqual, 100.0, 100.0, true)]
        [InlineData(ScetAlarmThresholdOp.LessThan, 100.0, 100.0, false)]
        [InlineData(ScetAlarmThresholdOp.LessThan, 100.0, 99.9, true)]
        [InlineData(ScetAlarmThresholdOp.LessThanOrEqual, 100.0, 100.0, true)]
        [InlineData(ScetAlarmThresholdOp.Equal, 100.0, 100.0, true)]
        [InlineData(ScetAlarmThresholdOp.Equal, 100.0, 100.1, false)]
        [InlineData(ScetAlarmThresholdOp.NotEqual, 100.0, 100.1, true)]
        [InlineData(ScetAlarmThresholdOp.NotEqual, 100.0, 100.0, false)]
        public void EveryOperatorMeansWhatTheClientsOwnListMeansByIt(
            ScetAlarmThresholdOp op, double threshold, double reading, bool fires)
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", threshold, op), "ksc");

            var tick = roster.Evaluate(1000, new FakeReader { Next = ScetReading.Observed(reading) });

            Assert.Equal(fires, tick.Fired.Count == 1);
        }

        [Fact]
        public void TheWarpStopsAtTheFirstMatchSoTheSustainWindowHasRealTicksToRunIn()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000, sustainSeconds: 5), "ksc");
            var reader = new FakeReader { Next = ScetReading.Observed(101_000) };

            // Matching, not yet sustained. Under warp a 5-second window would be
            // skipped clean over, so the stop comes first and the window is
            // measured in the real ticks the stop buys.
            var first = roster.Evaluate(1000, reader);
            Assert.True(first.StopWarp);
            Assert.Empty(first.Fired);

            Assert.Empty(roster.Evaluate(1004, reader).Fired);
            Assert.Single(roster.Evaluate(1005, reader).Fired);
        }

        [Fact]
        public void ASustainWindowRestartsWhenTheConditionStopsHolding()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000, sustainSeconds: 5), "ksc");
            var reader = new FakeReader { Next = ScetReading.Observed(101_000) };

            roster.Evaluate(1000, reader);
            reader.Next = ScetReading.Observed(99_000);
            roster.Evaluate(1003, reader);
            reader.Next = ScetReading.Observed(101_000);
            roster.Evaluate(1004, reader);

            // 1005 is five seconds after the FIRST match and one after the
            // current one. A window that did not restart would fire here.
            Assert.Empty(roster.Evaluate(1005, reader).Fired);
            Assert.Single(roster.Evaluate(1009, reader).Fired);
        }

        [Fact]
        public void AReadingThatCannotBeTakenLeavesTheAlarmPending()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000), "ksc");

            // No vessel loaded, an unknown path, a payload about another craft:
            // all of them mean "not now" and none of them may fire or disarm.
            var tick = roster.Evaluate(1000, new FakeReader { Next = ScetReading.NotObservable });

            Assert.Empty(tick.Fired);
            Assert.False(tick.StopWarp);
            Assert.Equal(ScetAlarmState.Armed, roster.Snapshot()[0].State);
        }

        [Fact]
        public void AThresholdWithNoReaderAtAllStaysPending()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000), "ksc");

            // The capture had no snapshot to read. Same fail-safe: an alarm that
            // cannot be evaluated does not fire.
            var tick = roster.Evaluate(1000);

            Assert.Empty(tick.Fired);
            Assert.False(tick.StopWarp);
        }

        [Fact]
        public void ACraftThatHasLeftTheSimulationMakesItsAlarmUnreachable()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000), "ksc");

            var tick = roster.Evaluate(1000, new FakeReader { Next = ScetReading.SubjectGone });

            Assert.True(tick.RosterChanged);
            Assert.Empty(tick.Fired);
            Assert.False(tick.StopWarp);
            Assert.Equal(ScetAlarmState.Unreachable, roster.Snapshot()[0].State);
        }

        [Fact]
        public void AnUnreachableAlarmIsNotAskedAboutAgain()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000), "ksc");
            var reader = new FakeReader { Next = ScetReading.SubjectGone };
            roster.Evaluate(1000, reader);
            reader.Asked.Clear();

            // The craft is not coming back, and a row that will never fire must
            // not keep costing a payload build every tick.
            Assert.False(roster.Evaluate(1001, reader).RosterChanged);
            Assert.Empty(reader.Asked);
        }

        [Fact]
        public void ReArmingCarriesTheWholeThresholdCondition()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(
                ThresholdAlarm("a", 100_000, ScetAlarmThresholdOp.LessThan, sustainSeconds: 3), "ksc");

            var condition = Assert.Single(roster.Snapshot()).Condition;
            Assert.Equal(ScetAlarmConditionKind.Threshold, condition.Kind);
            Assert.Equal("vessel.flight", condition.Topic);
            Assert.Equal("altitudeAsl", condition.FieldPath);
            Assert.Equal(ScetAlarmThresholdOp.LessThan, condition.Op);
            Assert.Equal(100_000, condition.Threshold);
            Assert.Equal(3, condition.SustainSeconds);

            // An identical re-arm on every reconnect must not churn the channel,
            // and the comparison has to see the threshold half to know that.
            Assert.False(roster.Arm(
                ThresholdAlarm("a", 100_000, ScetAlarmThresholdOp.LessThan, sustainSeconds: 3), "ksc"));
            Assert.True(roster.Arm(
                ThresholdAlarm("a", 100_001, ScetAlarmThresholdOp.LessThan, sustainSeconds: 3), "ksc"));
        }

        [Fact]
        public void ReArmingAThresholdDropsTheSustainWindowItWasHalfwayThrough()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(ThresholdAlarm("a", 100_000, sustainSeconds: 5), "ksc");
            var reader = new FakeReader { Next = ScetReading.Observed(101_000) };
            roster.Evaluate(1000, reader);

            // The operator moved the number. The condition they are watching now
            // has not held for anything yet.
            roster.Arm(ThresholdAlarm("a", 50_000, sustainSeconds: 5), "ksc");

            Assert.Empty(roster.Evaluate(1004, reader).Fired);
            Assert.Single(roster.Evaluate(1009, reader).Fired);
        }

        [Fact]
        public void ATimeAlarmAndAThresholdComingDueTogetherAreOneStopAndTwoNotices()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 1000), "ksc");
            roster.Arm(ThresholdAlarm("b", 100_000), "ksc");

            var tick = roster.Evaluate(1000, new FakeReader { Next = ScetReading.Observed(101_000) });

            Assert.True(tick.StopWarp);
            Assert.Equal(new[] { "a", "b" }, tick.Fired.Select(f => f.Id).ToArray());
        }
    }
}
