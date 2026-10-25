using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What a command centre is watching never reaches a session at another
    /// centre on the wire: the roster is redacted where each frame fans out to a
    /// session, so a log, a dev-tools panel or a widget that forgets to redact
    /// has nothing to show.
    /// </summary>
    public class ScetRosterViewerFilterTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private const string Armer = "ground:gs1";
        private const string Elsewhere = "ground:gs2";
        private const string SecretName = "Periapsis-watch-6431";
        private const double SecretThreshold = 76431.25;

        private static ScetAlarm Threshold(string id) => new ScetAlarm
        {
            Id = id,
            Name = SecretName,
            ArmedBy = Armer,
            Vantage = Armer,
            Subject = "vessel:00000000-0000-0000-0000-000000000001",
            State = ScetAlarmState.Armed,
            Condition = new ScetAlarmCondition
            {
                Kind = ScetAlarmConditionKind.Threshold,
                Topic = "vessel.flight",
                FieldPath = "altitude",
                Threshold = SecretThreshold,
            },
        };

        private static ScetAlarm Time(string id) => new ScetAlarm
        {
            Id = id,
            Name = "Burn start",
            ArmedBy = Armer,
            Vantage = Armer,
            Subject = "game",
            State = ScetAlarmState.Armed,
            Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.Time, Ut = 5000 },
        };

        [Fact]
        public async Task ASessionElsewhereIsSentNeitherTheNameNorTheConditionOfAThresholdAlarm()
        {
            var uplink = new ScetRosterTestUplink();
            using var engine = NewEngine(uplink);
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                uplink.Arm(Threshold("t1"));
                uplink.Arm(Time("time1"));

                await using var armer = await AtVantageAsync(engine, Armer);
                await using var elsewhere = await AtVantageAsync(engine, Elsewhere);
                await SubscribeAsync(armer, ScetRosterTestUplink.Topic, Timeout);
                await SubscribeAsync(elsewhere, ScetRosterTestUplink.Topic, Timeout);
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);

                var full = await ReceiveRosterAsync(armer);
                Assert.Contains(SecretName, full);
                var fullRow = Row(full, "t1");
                Assert.False(fullRow.GetProperty("withheld").GetBoolean());
                Assert.Equal(SecretThreshold, fullRow.GetProperty("condition").GetProperty("threshold").GetDouble());

                var redacted = await ReceiveRosterAsync(elsewhere);
                AssertNothingLeaks(redacted);
                var row = Row(redacted, "t1");
                Assert.True(row.GetProperty("withheld").GetBoolean());
                Assert.Equal(JsonValueKind.Null, row.GetProperty("condition").ValueKind);
                Assert.Equal(Armer, row.GetProperty("armedBy").GetString());
                Assert.Equal((int)ScetAlarmState.Armed, row.GetProperty("state").GetInt32());

                var time = Row(redacted, "time1");
                Assert.False(time.GetProperty("withheld").GetBoolean());
                Assert.Equal("Burn start", time.GetProperty("name").GetString());
                Assert.Equal(5000, time.GetProperty("condition").GetProperty("ut").GetDouble());
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ALiveRosterChangeAndALateSubscriberElsewhereAreRedactedToo()
        {
            var uplink = new ScetRosterTestUplink();
            using var engine = NewEngine(uplink);
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var elsewhere = await AtVantageAsync(engine, Elsewhere);
                await SubscribeAsync(elsewhere, ScetRosterTestUplink.Topic, Timeout);
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);
                await ReceiveRosterAsync(elsewhere);

                uplink.Arm(Threshold("live1"));
                engine.TickAndWait(3.0, new KspSnapshot { Ut = 3.0 }, Timeout);
                engine.TickAndWait(4.0, new KspSnapshot { Ut = 4.0 }, Timeout);
                var live = await ReceiveRosterAsync(elsewhere);
                AssertNothingLeaks(live);
                Assert.True(Row(live, "live1").GetProperty("withheld").GetBoolean());

                // The catch-up is delivered inside the subscribe, ahead of its
                // acknowledgement, so the frames are read from the subscribe on
                // rather than after waiting for the ack.
                await using var late = await AtVantageAsync(engine, Elsewhere);
                await late.SendAsync(EnvelopeCodec.WriteSubscribe(new Subscribe { Topic = ScetRosterTestUplink.Topic }));
                var caughtUp = await ReceiveRosterAsync(late);
                AssertNothingLeaks(caughtUp);
                Assert.True(Row(caughtUp, "live1").GetProperty("withheld").GetBoolean());
            }
            finally
            {
                engine.Stop();
            }
        }

        private static ChannelEngine NewEngine(ScetRosterTestUplink uplink)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(new StaticSource(Armer, CommandCentreKind.GroundStation));
            engine.RegisterCommandCentreSource(new StaticSource(Elsewhere, CommandCentreKind.GroundStation));
            engine.RegisterUplink(uplink);
            return engine;
        }

        private static async Task<TestClient> AtVantageAsync(ChannelEngine engine, string vantage)
        {
            var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
            await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = vantage }));
            return client;
        }

        /// <summary>The raw text of the next roster frame, which is what an assertion about a leak has to read.</summary>
        private static async Task<string> ReceiveRosterAsync(TestClient client)
        {
            while (true)
            {
                var raw = await client.ReceiveAsync(Timeout);
                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData data
                    && data.Topic == ScetRosterTestUplink.Topic)
                {
                    return raw;
                }
            }
        }

        private static void AssertNothingLeaks(string raw)
        {
            Assert.DoesNotContain(SecretName, raw);
            Assert.DoesNotContain("76431", raw);
            Assert.DoesNotContain("vessel.flight", raw);
            Assert.DoesNotContain("vessel:00000000-0000-0000-0000-000000000001", raw);
        }

        private static JsonElement Row(string raw, string id)
        {
            using var doc = JsonDocument.Parse(raw);
            foreach (var row in doc.RootElement.GetProperty("payload").EnumerateArray())
            {
                if (row.GetProperty("id").GetString() == id)
                {
                    return row.Clone();
                }
            }
            throw new KeyNotFoundException($"no roster row {id}");
        }

        private sealed class StaticSource : ICommandCentreSource
        {
            private readonly ICommandCentre _centre;

            public StaticSource(string id, CommandCentreKind kind) => _centre = new Centre(id, kind);

            public string ProviderId => "static-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return _centre;
            }

            private sealed class Centre : ICommandCentre
            {
                public Centre(string id, CommandCentreKind kind)
                {
                    Id = id;
                    Kind = kind;
                }

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind { get; }
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
