using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// What an armed alarm that nobody ever disarms costs, measured. An armed
    /// alarm has no expiry, so the roster grows by one row and one standing
    /// subscription per alarm for as long as the game session lives.
    /// </summary>
    public class ScetRosterGrowthTests
    {
        private const int Alarms = 1000;

        private static ScetAlarmArmArgs Threshold(int n) => new ScetAlarmArmArgs
        {
            Id = "alarm-" + n,
            Name = "Alarm number " + n,
            Subject = "vessel:00000000-0000-0000-0000-000000000000",
            Condition = new ScetAlarmCondition
            {
                Kind = ScetAlarmConditionKind.Threshold,
                Topic = "vessel.flight",
                FieldPath = "altitudeAsl",
                Op = ScetAlarmThresholdOp.GreaterThan,
                Threshold = 70000,
            },
        };

        [Fact]
        public void EveryArmedAlarmCostsOneRowAndOneStandingSubscriptionForever()
        {
            var roster = new ScetAlarmRoster();
            for (var i = 0; i < Alarms; i++)
            {
                roster.Arm(Threshold(i), "ground:KSC");
            }

            var held = 0;
            var subscriptions = new ScetAlarmSubscriptions((_, __) => held++, (_, __) => held--);
            subscriptions.Reconcile(roster.Snapshot());

            var wire = EnvelopeCodec.WriteStreamData(
                new StreamData<object?> { Topic = "alarm.activeList", Payload = roster.Snapshot() });
            var bytesPerRow = wire.Length / (double)Alarms;

            Assert.Equal(Alarms, held);
            // The measured figure is about 440 bytes a row; a ceiling at 1 KB is what notices a row that gets heavier.
            Assert.InRange(bytesPerRow, 100, 1024);
        }

        [Fact]
        public void OnlyDisarmingShrinksTheRoster()
        {
            var roster = new ScetAlarmRoster();
            for (var i = 0; i < 10; i++)
            {
                roster.Arm(Threshold(i), "ground:KSC");
            }

            roster.Evaluate(1_000_000, new FakeReader());

            Assert.Equal(10, roster.Snapshot().Count);
        }

        private sealed class FakeReader : IScetStateReader
        {
            public IDictionary<string, object?>? ReadPayload(string subject, string topic) => null;

            public ScetReading Read(string subject, string topic, string fieldPath) => ScetReading.NotObservable;
        }
    }
}
