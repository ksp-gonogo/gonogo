using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A contract-parameter alarm judged by the simulation: one objective of one
    /// active contract reaching the state the operator chose, read out of the
    /// career the reader hands over, with the same two instants a threshold has.
    /// </summary>
    public class ScetContractParameterAlarmTests
    {
        private sealed class CareerReader : IScetStateReader
        {
            public IDictionary<string, object?>? Career;

            public IDictionary<string, object?>? ReadPayload(string subject, string topic) =>
                subject == "game" && topic == CareerViewProvider.Topic ? Career : null;

            public ScetReading Read(string subject, string topic, string fieldPath) => ScetReading.NotObservable;
        }

        private static IDictionary<string, object?> Career(params (string id, string title, object? ordinal)[] objectives) =>
            new Dictionary<string, object?>
            {
                ["meta"] = new Dictionary<string, object?> { ["source"] = "game" },
                ["contracts"] = new Dictionary<string, object?>
                {
                    ["active"] = objectives
                        .GroupBy(o => o.id)
                        .Select(g => (object?)new Dictionary<string, object?>
                        {
                            ["id"] = g.Key,
                            ["parameters"] = g.Select(o => (object?)new Dictionary<string, object?>
                            {
                                ["title"] = o.title,
                                ["state"] = "Complete",
                                ["stateOrdinal"] = o.ordinal,
                            }).ToList(),
                        })
                        .ToList(),
                },
            };

        private static ScetAlarmArmArgs Objective(
            string contractId = "c-42",
            string title = "Orbit the Mun",
            KspParameterState target = KspParameterState.Complete,
            double sustainSeconds = 0) =>
            new ScetAlarmArmArgs
            {
                Id = "a1",
                Name = "Mun orbit done",
                Subject = "game",
                Condition = new ScetAlarmCondition
                {
                    Kind = ScetAlarmConditionKind.ContractParameter,
                    ContractId = contractId,
                    ParameterTitle = title,
                    TargetState = target,
                    SustainSeconds = sustainSeconds,
                },
            };

        [Fact]
        public void FiresWhenTheObjectiveReachesItsTargetState()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Objective(), "");
            var reader = new CareerReader { Career = Career(("c-42", "Orbit the Mun", 0)) };

            var before = roster.Evaluate(10, reader);
            reader.Career = Career(("c-42", "Orbit the Mun", 1));
            var after = roster.Evaluate(11, reader);

            Assert.Empty(before.Fired);
            Assert.False(before.StopWarp);
            Assert.Equal("a1", Assert.Single(after.Fired).Id);
            Assert.True(after.StopWarp);
        }

        [Fact]
        public void AnObjectiveAlreadyInItsStateWhenArmedIsAConditionThatHolds()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Objective(), "");

            var tick = roster.Evaluate(10, new CareerReader { Career = Career(("c-42", "Orbit the Mun", 1)) });

            Assert.Single(tick.Fired);
        }

        [Fact]
        public void StopsTheWarpAtTheFirstMatchAndFiresAfterTheSustain()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Objective(sustainSeconds: 5), "");
            var reader = new CareerReader { Career = Career(("c-42", "Orbit the Mun", 1)) };

            var first = roster.Evaluate(10, reader);
            var early = roster.Evaluate(12, reader);
            var due = roster.Evaluate(15, reader);

            Assert.True(first.StopWarp);
            Assert.Empty(first.Fired);
            Assert.Empty(early.Fired);
            Assert.Single(due.Fired);
        }

        [Fact]
        public void AContractNoLongerActiveNeverComesDue()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Objective(), "");

            var tick = roster.Evaluate(10, new CareerReader { Career = Career(("c-other", "Orbit the Mun", 1)) });

            Assert.Empty(tick.Fired);
            Assert.False(tick.StopWarp);
        }

        [Fact]
        public void MatchesOnTheOrdinalAndNotTheName()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Objective(target: KspParameterState.Complete), "");

            // The name on the wire says Complete; the ordinal says Failed.
            var tick = roster.Evaluate(10, new CareerReader { Career = Career(("c-42", "Orbit the Mun", 2)) });

            Assert.Empty(tick.Fired);
        }

        /// <summary>
        /// An unreadable career is no statement about the objective, so it must
        /// neither fire the alarm nor clear a sustain window that has started.
        /// </summary>
        [Fact]
        public void AnUnreadableCareerHoldsTheSustainWindowOpen()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Objective(sustainSeconds: 5), "");
            var reader = new CareerReader { Career = Career(("c-42", "Orbit the Mun", 1)) };

            roster.Evaluate(10, reader);
            reader.Career = new Dictionary<string, object?> { ["meta"] = new Dictionary<string, object?> { ["source"] = "game" } };
            var dark = roster.Evaluate(12, reader);
            reader.Career = Career(("c-42", "Orbit the Mun", 1));
            var back = roster.Evaluate(15, reader);

            Assert.Empty(dark.Fired);
            Assert.Single(back.Fired);
        }

        /// <summary>
        /// Through the real reader and the real career payload, so the walk is
        /// held to the shape the provider actually builds rather than to a
        /// fixture of this file's own.
        /// </summary>
        [Fact]
        public void FiresOffTheCareerTheSnapshotReaderBuilds()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 10,
                Values = new Dictionary<string, object?>
                {
                    ["career"] = new Dictionary<string, object?>
                    {
                        ["contracts"] = new Dictionary<string, object?>
                        {
                            ["active"] = new List<object?>
                            {
                                new Dictionary<string, object?>
                                {
                                    ["id"] = "c-42",
                                    ["parameters"] = new List<object?>
                                    {
                                        new Dictionary<string, object?>
                                        {
                                            ["title"] = "Orbit the Mun",
                                            ["state"] = "Complete",
                                            ["stateOrdinal"] = 1,
                                        },
                                    },
                                },
                            },
                            ["offered"] = new List<object?>(),
                        },
                    },
                },
            };
            var roster = new ScetAlarmRoster();
            roster.Arm(Objective(), "");

            var tick = roster.Evaluate(10, new SnapshotScetStateReader(snapshot, ScetThresholdSources.CoreOnly));

            Assert.Single(tick.Fired);
        }

        [Fact]
        public void ChangingTheObjectiveIsAChange()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Objective(), "");

            Assert.True(roster.Arm(Objective(title: "Land on the Mun"), ""));
            Assert.Equal("Land on the Mun", Assert.Single(roster.Snapshot()).Condition.ParameterTitle);
        }

        [Fact]
        public void TheCareerIsHeldOnTheRecordForAnArmedObjective()
        {
            var opened = new List<string>();
            var subscriptions = new ScetAlarmSubscriptions((topic, _) => opened.Add(topic), (_, _) => { });
            var roster = new ScetAlarmRoster();
            roster.Arm(Objective(), "");

            subscriptions.Reconcile(roster.Snapshot());

            Assert.Equal(new[] { CareerViewProvider.Topic }, opened);
        }

        [Fact]
        public void TheConditionCarriesTheObjectiveOnTheWire()
        {
            var json = EnvelopeCodec.WriteStreamData(new StreamData<object?>
            {
                Topic = "alarm.scet",
                Payload = new List<ScetAlarm> { new ScetAlarm { Id = "a1", Condition = Objective().Condition } },
            });

            Assert.Contains("\"contractId\":\"c-42\",\"parameterTitle\":\"Orbit the Mun\",\"targetState\":1", json);
        }
    }
}
