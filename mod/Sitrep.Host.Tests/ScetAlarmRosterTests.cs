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
    /// <para>Every assertion here is about a clock the roster is TOLD, never one
    /// it reads, which is what lets the feature be exercised without a game. The
    /// KSP half is <c>Gonogo.KSP.ScetAlarmUplink</c> and is three calls long by
    /// design.</para>
    /// </summary>
    public class ScetAlarmRosterTests
    {
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
    }
}
