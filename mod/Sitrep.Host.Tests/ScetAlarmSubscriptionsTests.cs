using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Keeping the armed thresholds' Topics on the record: which ones, and the
    /// opens and closes between one roster and the next.
    /// </summary>
    public class ScetAlarmSubscriptionsTests
    {
        private const string Flight = "vessel.flight";
        private const string Orbit = "vessel.orbit";

        private sealed class Calls
        {
            public readonly List<string> Opened = new List<string>();
            public readonly List<string> Closed = new List<string>();

            public ScetAlarmSubscriptions Subscriptions() =>
                new ScetAlarmSubscriptions(
                    (topic, holder) => Opened.Add(topic + " " + holder),
                    (topic, holder) => Closed.Add(topic + " " + holder));
        }

        private static ScetAlarm Threshold(
            string id, string topic = Flight, ScetAlarmState state = ScetAlarmState.Armed) =>
            new ScetAlarm
            {
                Id = id,
                State = state,
                Subject = "vessel:abc",
                Condition = new ScetAlarmCondition
                {
                    Kind = ScetAlarmConditionKind.Threshold,
                    Topic = topic,
                    FieldPath = "altitudeAsl",
                    Threshold = 100_000,
                },
            };

        private static ScetAlarm Time(string id) =>
            new ScetAlarm
            {
                Id = id,
                State = ScetAlarmState.Armed,
                Subject = "game",
                Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.Time, Ut = 500 },
            };

        [Fact]
        public void AnArmedThresholdHoldsItsTopic()
        {
            var calls = new Calls();

            calls.Subscriptions().Reconcile(new[] { Threshold("a") });

            Assert.Equal(new[] { "vessel.flight scet-alarm:a" }, calls.Opened);
            Assert.Empty(calls.Closed);
        }

        /// <summary>
        /// A time condition addresses no Topic, so there is nothing about it the
        /// archive could be missing.
        /// </summary>
        [Fact]
        public void ATimeAlarmHoldsNothing()
        {
            var calls = new Calls();

            calls.Subscriptions().Reconcile(new[] { Time("a") });

            Assert.Empty(calls.Opened);
        }

        [Fact]
        public void ADisarmedAlarmLetsItsTopicGo()
        {
            var calls = new Calls();
            var subscriptions = calls.Subscriptions();

            subscriptions.Reconcile(new[] { Threshold("a") });
            subscriptions.Reconcile(new ScetAlarm[0]);

            Assert.Equal(new[] { "vessel.flight scet-alarm:a" }, calls.Closed);
        }

        /// <summary>
        /// A fired or unreachable alarm will never take another reading, so
        /// holding its Topic would pin a history nothing is going to read.
        /// </summary>
        [Theory]
        [InlineData(ScetAlarmState.Fired)]
        [InlineData(ScetAlarmState.Unreachable)]
        public void AnAlarmThatWillNeverReadAgainLetsItsTopicGo(ScetAlarmState state)
        {
            var calls = new Calls();
            var subscriptions = calls.Subscriptions();

            subscriptions.Reconcile(new[] { Threshold("a") });
            subscriptions.Reconcile(new[] { Threshold("a", state: state) });

            Assert.Equal(new[] { "vessel.flight scet-alarm:a" }, calls.Closed);
        }

        /// <summary>
        /// Re-armed onto another Topic, the alarm lets the old one go before it
        /// takes the new one, so nothing is held that nothing wants.
        /// </summary>
        [Fact]
        public void AnAlarmThatMovedTopicsLetsGoOfTheOneItLeft()
        {
            var calls = new Calls();
            var subscriptions = calls.Subscriptions();

            subscriptions.Reconcile(new[] { Threshold("a") });
            calls.Opened.Clear();
            subscriptions.Reconcile(new[] { Threshold("a", topic: Orbit) });

            Assert.Equal(new[] { "vessel.flight scet-alarm:a" }, calls.Closed);
            Assert.Equal(new[] { "vessel.orbit scet-alarm:a" }, calls.Opened);
        }

        /// <summary>
        /// Two alarms on one Topic are two holders, so disarming either leaves
        /// the other's hold standing. The counting is the engine's, and this is
        /// what gives it something to count.
        /// </summary>
        [Fact]
        public void TwoAlarmsOnOneTopicAreTwoHolders()
        {
            var calls = new Calls();
            var subscriptions = calls.Subscriptions();

            subscriptions.Reconcile(new[] { Threshold("a"), Threshold("b") });
            Assert.Equal(
                new[] { "vessel.flight scet-alarm:a", "vessel.flight scet-alarm:b" },
                calls.Opened.OrderBy(c => c));

            subscriptions.Reconcile(new[] { Threshold("b") });
            Assert.Equal(new[] { "vessel.flight scet-alarm:a" }, calls.Closed);
        }

        /// <summary>
        /// An unchanged roster asks for nothing. The engine's own open is
        /// idempotent, so this is about not queueing a job per tick for a roster
        /// that has not moved.
        /// </summary>
        [Fact]
        public void AnUnchangedRosterAsksForNothing()
        {
            var calls = new Calls();
            var subscriptions = calls.Subscriptions();

            subscriptions.Reconcile(new[] { Threshold("a") });
            calls.Opened.Clear();
            subscriptions.Reconcile(new[] { Threshold("a") });

            Assert.Empty(calls.Opened);
            Assert.Empty(calls.Closed);
        }

        /// <summary>
        /// A rewind clears the roster to nothing at all, and every hold goes with
        /// it: the alarms were armed in a timeline that no longer exists.
        /// </summary>
        [Fact]
        public void ANullRosterLetsEverythingGo()
        {
            var calls = new Calls();
            var subscriptions = calls.Subscriptions();

            subscriptions.Reconcile(new[] { Threshold("a"), Threshold("b", topic: Orbit) });
            subscriptions.Reconcile(null);

            Assert.Equal(
                new[] { "vessel.flight scet-alarm:a", "vessel.orbit scet-alarm:b" },
                calls.Closed.OrderBy(c => c));
        }
    }
}
