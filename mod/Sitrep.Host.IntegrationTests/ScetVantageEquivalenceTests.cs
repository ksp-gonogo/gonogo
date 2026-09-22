using System;
using System.Collections.Generic;
using System.Linq;
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
    /// <para>One roster holds both, and the tick is taken in two passes because
    /// the two read from different places: the craft's own vantage reads this
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
    /// equivalence because neither alarm comes due, and the control because the
    /// late one is late forever. That is the hole
    /// <see cref="VantageReadSubscriptionStarvationTests"/> measured.</para>
    /// </summary>
    public class ScetVantageEquivalenceTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(300);

        private const string CommandVantage = "ground:Kerbal Space Center";
        private const string Holder = "scet-alarm:equivalence";

        private const string AtCraft = "at-craft";
        private const string AtCentre = "at-centre";

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
                var roster = RosterHoldingBoth();

                var quiet = await TickAsync(engine, client, roster, 0.0, BelowThreshold, delay: 0.0);
                Assert.Empty(quiet);

                var crossing = await TickAsync(
                    engine, client, roster, CrossingUt, AboveThreshold, delay: 0.0);
                Assert.Equal(new[] { AtCentre, AtCraft }, crossing.OrderBy(id => id));
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
                var roster = RosterHoldingBoth();

                await TickAsync(engine, client, roster, 0.0, BelowThreshold, OneWaySeconds);

                // The craft's own vantage is over the threshold now, and the
                // centre has been told nothing about it.
                var crossing = await TickAsync(
                    engine, client, roster, CrossingUt, AboveThreshold, OneWaySeconds);
                Assert.Equal(new[] { AtCraft }, crossing);

                // ...and the centre comes due once the light carrying the
                // crossing lands, on a tick that tells the craft's alarm nothing
                // new because it has already latched.
                var arrival = await TickAsync(
                    engine, client, roster, CrossingUt + OneWaySeconds, AboveThreshold, OneWaySeconds);
                Assert.Equal(new[] { AtCentre }, arrival);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// One roster holding the same condition twice, once at the craft and
        /// once at the centre. Which reader each gets is decided by
        /// <see cref="ScetAlarmVantage.IsTheSubjectsOwn"/>, exactly as
        /// <c>ScetAlarmUplink</c> decides it.
        /// </summary>
        private static ScetAlarmRoster RosterHoldingBoth()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(Arm(AtCraft, ScetVantageTestUplink.Subject), CommandVantage);
            roster.Arm(Arm(AtCentre, CommandVantage), CommandVantage);
            return roster;
        }

        private static ScetAlarmArmArgs Arm(string id, string vantage) =>
            new ScetAlarmArmArgs
            {
                Id = id,
                Vantage = vantage,
                Subject = ScetVantageTestUplink.Subject,
                Condition = new ScetAlarmCondition
                {
                    Kind = ScetAlarmConditionKind.Threshold,
                    Topic = ScetVantageTestUplink.FlightTopic,
                    FieldPath = ScetVantageTestUplink.AltitudeField,
                    Op = ScetAlarmThresholdOp.GreaterThan,
                    Threshold = Threshold,
                    // No sustain window: the question is which TICK each alarm
                    // comes due on, and a window would put a span between the
                    // answer and the reading that caused it.
                    SustainSeconds = 0,
                },
            };

        /// <summary>
        /// Advance the engine, then take one tick of the roster in the two passes
        /// the uplink takes it in, and answer with the ids that came due.
        ///
        /// <para>The archive is read from the test thread, which is safe only
        /// because the Courier is parked on an empty job queue by now: the tick
        /// has returned and the drain waited out the quiet period. Production
        /// asks this from the Courier thread, which is the whole reason that pass
        /// lives in the handle.</para>
        /// </summary>
        private static async Task<List<string>> TickAsync(
            ChannelEngine engine,
            TestClient client,
            ScetAlarmRoster roster,
            double ut,
            double altitudeAsl,
            double delay)
        {
            var snapshot = ScetVantageTestUplink.Snapshot(ut, altitudeAsl, delay);
            engine.TickAndWait(ut, snapshot, Timeout);
            await DrainAllStreamDataAsync(client, Quiet);

            var tick = roster.BeginTick(ut);
            roster.EvaluatePass(
                tick,
                ScetAlarmVantage.IsTheSubjectsOwn,
                _ => new SnapshotScetStateReader(snapshot, ScetThresholdSources.CoreOnly));
            roster.EvaluatePass(
                tick,
                alarm => !ScetAlarmVantage.IsTheSubjectsOwn(alarm),
                alarm => new RevealedScetStateReader(
                    engine.ReadTopicAtVantage, ScetAlarmVantage.Of(alarm), ut));

            return roster.EndTick(tick).Fired.Select(notice => notice.Id ?? "").ToList();
        }
    }
}
