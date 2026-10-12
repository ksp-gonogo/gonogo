using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// An alarm that follows a Topic's own instant: the warp stops the lead
    /// before whatever instant the Topic publishes now, the alarm fires when the
    /// clock reaches it, and the instant moving between ticks re-aims both.
    /// </summary>
    public class ScetTopicInstantAlarmTests
    {
        private const string Topic = "career.status";

        private sealed class InstantReader : IScetStateReader
        {
            public double? Instant;
            public bool Gone;

            public IDictionary<string, object?>? ReadPayload(string subject, string topic) => null;

            public ScetReading Read(string subject, string topic, string fieldPath)
            {
                if (Gone)
                {
                    return ScetReading.SubjectGone;
                }
                return topic == Topic && fieldPath == "ut" && Instant != null
                    ? ScetReading.Observed(Instant.Value)
                    : ScetReading.NotObservable;
            }
        }

        private static ScetAlarmArmArgs Follow(double lead = 10) =>
            new ScetAlarmArmArgs
            {
                Id = "a1",
                Name = "Next project",
                Subject = "game",
                Condition = new ScetAlarmCondition
                {
                    Kind = ScetAlarmConditionKind.TopicInstant,
                    Topic = Topic,
                    FieldPath = "ut",
                    LeadSeconds = lead,
                },
            };

        [Fact]
        public void StopsTheWarpTheLeadBeforeTheInstantAndFiresAtIt()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Follow(), "");
            var reader = new InstantReader { Instant = 1000 };

            var early = roster.Evaluate(900, reader);
            var inLead = roster.Evaluate(990, reader);
            var due = roster.Evaluate(1000, reader);

            Assert.False(early.StopWarp);
            Assert.True(inLead.StopWarp);
            Assert.Empty(inLead.Fired);
            Assert.Equal("a1", Assert.Single(due.Fired).Id);
        }

        [Fact]
        public void ReAimsWhenTheInstantMovesEarlier()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Follow(), "");
            var reader = new InstantReader { Instant = 5000 };

            roster.Evaluate(100, reader);
            reader.Instant = 700;
            var overtaken = roster.Evaluate(695, reader);
            var due = roster.Evaluate(700, reader);

            Assert.True(overtaken.StopWarp);
            Assert.Single(due.Fired);
            Assert.Equal(700, roster.Snapshot()[0].Condition!.Ut);
        }

        [Fact]
        public void StopsTheWarpAgainWhenTheInstantMovesLaterAndComesBackIn()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Follow(), "");
            var reader = new InstantReader { Instant = 1000 };

            var first = roster.Evaluate(995, reader);
            reader.Instant = 3000;
            var pushed = roster.Evaluate(996, reader);
            var again = roster.Evaluate(2995, reader);

            Assert.True(first.StopWarp);
            Assert.False(pushed.StopWarp);
            Assert.Empty(pushed.Fired);
            Assert.True(again.StopWarp);
        }

        [Fact]
        public void AnAbsentInstantIsAConditionThatDoesNotHold()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Follow(), "");

            var tick = roster.Evaluate(10, new InstantReader { Instant = null });

            Assert.Empty(tick.Fired);
            Assert.False(tick.StopWarp);
            Assert.Equal(ScetAlarmState.Armed, roster.Snapshot()[0].State);
        }

        [Fact]
        public void ARearmWithTheSameFollowChangesNothingEvenAfterTheInstantWasRead()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Follow(), "");
            roster.Evaluate(10, new InstantReader { Instant = 4000 });

            var changed = roster.Arm(Follow(), "");

            Assert.False(changed);
        }
    }
}
