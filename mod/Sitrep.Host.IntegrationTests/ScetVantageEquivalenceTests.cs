using System;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Alarms;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// At zero light-time, an alarm at the craft's own vantage and an alarm at a
    /// command centre's vantage on the SAME condition come due on the same tick.
    ///
    /// <para>The two are evaluated through different readers and that is the
    /// whole of the difference between them: the craft's own vantage reads this
    /// tick's snapshot, upstream of the reveal gate, and a command vantage reads
    /// what the archive says has reached that place. With no light between them
    /// those are the same state, and an operator whose two alarms disagreed would
    /// have no way to tell which one the simulation meant.</para>
    ///
    /// <para><b>The equivalence must not be bought by dropping the delay</b>, so
    /// the control here is the one
    /// <see cref="VantageReadInstantClassTests.OrdinaryDelayedTopicIsStillLightTimeLateAtACommandVantage"/>
    /// keeps: put four minutes of light between the craft and the centre and the
    /// two alarms MUST come due four minutes apart, the craft's first. A gate
    /// that can only pass is not a gate.</para>
    ///
    /// <para>Both cases hold a standing subscription on the threshold's Topic.
    /// Without one the archive records nothing, the command-vantage read is blind
    /// whatever the delay, and both cases pass for the wrong reason: the
    /// equivalence because neither alarm fires, and the control because the late
    /// one is late forever. That is the hole
    /// <see cref="VantageReadSubscriptionStarvationTests"/> measured.</para>
    /// </summary>
    public class ScetVantageEquivalenceTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(300);

        private const string CommandVantage = "ground:Kerbal Space Center";
        private const string Holder = "scet-alarm:equivalence";

        /// <summary>Below the threshold, then over it, so the crossing is an event rather than a starting state.</summary>
        private const double BelowThreshold = 80_000;
        private const double AboveThreshold = 101_000;
        private const double Threshold = 100_000;

        private const double CrossingUt = 1.0;
        private const double OneWaySeconds = 240.0;

        [Fact]
        public async Task AtZeroLightTimeBothVantagesComeDueOnTheSameTick()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ScetVantageTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                engine.OpenStandingSubscription(ScetVantageTestUplink.FlightTopic, Holder);

                var atCraft = RosterHolding("at-craft", ScetVantageTestUplink.Subject);
                var atCentre = RosterHolding("at-centre", CommandVantage);

                var before = await TickAsync(engine, client, 0.0, BelowThreshold, delay: 0.0);
                Assert.False(FiredAtCraft(atCraft, before, 0.0));
                Assert.False(FiredAtVantage(atCentre, engine, 0.0));

                var crossing = await TickAsync(engine, client, CrossingUt, AboveThreshold, delay: 0.0);
                Assert.True(FiredAtCraft(atCraft, crossing, CrossingUt));
                Assert.True(FiredAtVantage(atCentre, engine, CrossingUt));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The control. Four minutes of light, and the command centre comes due
        /// four minutes after the craft does, on the tick its own reading of the
        /// crossing arrives. The craft's alarm is unmoved by the distance, which
        /// is what says the two readers were told apart rather than merged.
        /// </summary>
        [Fact]
        public async Task ACommandVantageIsStillLightTimeLateOnTheSameCondition()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ScetVantageTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                engine.OpenStandingSubscription(ScetVantageTestUplink.FlightTopic, Holder);

                var atCraft = RosterHolding("at-craft", ScetVantageTestUplink.Subject);
                var atCentre = RosterHolding("at-centre", CommandVantage);

                await TickAsync(engine, client, 0.0, BelowThreshold, OneWaySeconds);
                var crossing = await TickAsync(engine, client, CrossingUt, AboveThreshold, OneWaySeconds);

                // The craft's own vantage is over the threshold now, and the
                // centre has been told nothing about it.
                Assert.True(FiredAtCraft(atCraft, crossing, CrossingUt));
                Assert.False(FiredAtVantage(atCentre, engine, CrossingUt));

                // ...and it comes due once the light carrying the crossing lands.
                Assert.True(FiredAtVantage(atCentre, engine, CrossingUt + OneWaySeconds));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// One alarm on <c>vessel.flight</c>'s altitude, armed at
        /// <paramref name="vantage"/>. A roster each rather than one holding
        /// both, because the roster is still keyed by audience; what the cases
        /// above assert is about the two READERS, so it survives that being one
        /// roster with a vantage on each entry.
        /// </summary>
        private static ScetAlarmRoster RosterHolding(string id, string vantage)
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(
                new ScetAlarmArmArgs
                {
                    Id = id,
                    Audience = vantage,
                    Subject = ScetVantageTestUplink.Subject,
                    Condition = new ScetAlarmCondition
                    {
                        Kind = ScetAlarmConditionKind.Threshold,
                        Topic = ScetVantageTestUplink.FlightTopic,
                        FieldPath = ScetVantageTestUplink.AltitudeField,
                        Op = ScetAlarmThresholdOp.GreaterThan,
                        Threshold = Threshold,
                        // No sustain window: the question is which TICK each
                        // alarm comes due on, and a window would put a span
                        // between the answer and the reading that caused it.
                        SustainSeconds = 0,
                    },
                },
                vantage);
            return roster;
        }

        /// <summary>
        /// Advance the engine and wait out the frames, answering with the
        /// snapshot that tick was taken from: the craft's own vantage reads that
        /// snapshot, exactly as the production capture does.
        /// </summary>
        private static async Task<KspSnapshot> TickAsync(
            ChannelEngine engine, TestClient client, double ut, double altitudeAsl, double delay)
        {
            var snapshot = ScetVantageTestUplink.Snapshot(ut, altitudeAsl, delay);
            engine.TickAndWait(ut, snapshot, Timeout);
            await DrainAllStreamDataAsync(client, Quiet);
            return snapshot;
        }

        private static bool FiredAtCraft(ScetAlarmRoster roster, KspSnapshot snapshot, double ut) =>
            roster.Evaluate(ut, new SnapshotScetStateReader(snapshot, ScetThresholdSources.CoreOnly))
                .Fired.Count > 0;

        /// <summary>
        /// Asked from the test thread, which is safe only because the Courier is
        /// parked on an empty job queue by now: the tick has returned and the
        /// drain waited out the quiet period. Production asks this from the
        /// Courier thread, which is the whole reason the audience evaluation
        /// lives in the handle.
        /// </summary>
        private static bool FiredAtVantage(ScetAlarmRoster roster, ChannelEngine engine, double ut) =>
            roster.Evaluate(
                    ut,
                    new RevealedScetStateReader(engine.ReadTopicAtVantage, CommandVantage, ut))
                .Fired.Count > 0;
    }
}
