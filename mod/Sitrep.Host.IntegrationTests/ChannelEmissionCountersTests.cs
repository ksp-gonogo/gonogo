using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The <c>system.channels</c> diagnostic Topic: proof that a channel the
    /// engine considered and a channel it never considered read DIFFERENTLY off
    /// the wire.
    ///
    /// <para>That difference is the whole deliverable. One vessel channel
    /// delivered zero frames in a 20-second capture while another delivered
    /// throughout the same one, and no capture taken
    /// from outside the mod can narrow it, because "the engine never called
    /// Decide for this channel" and "the engine called Decide and the emitter
    /// declined" produce identical silence. Those two have completely different
    /// causes, so a test that only proved the numbers appear on the wire would
    /// miss the point: what is asserted here is that the two cases DISAGREE.</para>
    /// </summary>
    public class ChannelEmissionCountersTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(500);

        /// <summary>
        /// Both silence cases, side by side, with a subscriber on each so the
        /// outer gate cannot be what tells them apart.
        ///
        /// <para><c>counters.steady</c> maps to a value that never changes, so
        /// after its subscribe keyframe the change-gate declines every
        /// consideration: <c>considered</c> climbs, <c>emitted</c> stays at its
        /// keyframe floor of one, and <c>skipped</c> carries the rest.
        /// <c>counters.silent</c> maps to null forever, so the birth gate holds
        /// it short of the emitter and <c>considered</c> never leaves zero.
        /// <c>counters.unwatched</c> is the third reading, the ordinary one:
        /// nobody subscribed, so nothing was sampled and the row says so.</para>
        /// </summary>
        [Fact]
        public async Task ConsideredAndNeverConsideredChannelsReadDifferentlyOnTheWire()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CounterProbeUplink());
            // Before Start, per the seam's own doc comment.
            engine.SetChannelCounterIntervalForTests(0);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await SubscribeAsync(client, ChannelEngine.ChannelsTopic, Timeout);
                await SubscribeAsync(client, CounterProbeUplink.SteadyTopic, Timeout);
                await SubscribeAsync(client, CounterProbeUplink.SilentTopic, Timeout);

                // Ten UT apart, clearing the roster channel's own
                // MinSampleIntervalUt of five so every tick can republish.
                foreach (var ut in new[] { 0.0, 10.0, 20.0, 30.0 })
                {
                    engine.TickAndWait(ut, CounterProbeUplink.Snapshot(), Timeout);
                }

                var rows = await RosterAsync(client);

                var steady = rows[CounterProbeUplink.SteadyTopic];
                var silent = rows[CounterProbeUplink.SilentTopic];

                // THE distinction: same subscriber count, opposite readings.
                Assert.Equal(1L, Count(steady, "subscribers"));
                Assert.Equal(1L, Count(silent, "subscribers"));
                Assert.True(Count(steady, "considered") > 0);
                Assert.Equal(0L, Count(silent, "considered"));

                // Considered, and declining. The roster is built before this
                // tick's own mapper runs (see ChannelEmissionReport), so the
                // last frame reports the first three of the four ticks.
                Assert.Equal(3L, Count(steady, "considered"));
                Assert.Equal(1L, Count(steady, "emitted"));
                Assert.Equal(2L, Count(steady, "skipped"));
                Assert.True(Flag(steady, "born"));
                Assert.True(Flag(steady, "tickMapped"));
                Assert.True(Flag(steady, "available"));

                // Never considered, and the flags name which gate did it: a
                // subscriber is present, the uplink is fine, a tick-driven
                // mapper is wired, and the channel was never born.
                Assert.Equal(0L, Count(silent, "emitted"));
                Assert.Equal(0L, Count(silent, "skipped"));
                Assert.False(Flag(silent, "born"));
                Assert.True(Flag(silent, "tickMapped"));
                Assert.True(Flag(silent, "available"));

                // The ordinary zero, which must stay tellable from both above.
                var unwatched = rows[CounterProbeUplink.UnwatchedTopic];
                Assert.Equal(0L, Count(unwatched, "subscribers"));
                Assert.Equal(0L, Count(unwatched, "considered"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// An uplink taken Unavailable is the OTHER cause of a never-considered
        /// channel, and it must not read like the birth gate: every channel the
        /// uplink owns goes inert together, so a channel that was emitting
        /// happily stops being considered with <c>available</c> false and
        /// <c>born</c> still true.
        /// </summary>
        [Fact]
        public async Task AnUnavailableUplinkReadsAsUnavailableRatherThanUnborn()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var uplink = new CounterProbeUplink();
            engine.RegisterUplink(uplink);
            engine.SetChannelCounterIntervalForTests(0);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.ChannelsTopic, Timeout);
                await SubscribeAsync(client, CounterProbeUplink.SteadyTopic, Timeout);

                engine.TickAndWait(0.0, CounterProbeUplink.Snapshot(), Timeout);

                // The steady mapper throws from here on, which fail-softs the
                // whole uplink from the NEXT tick onward.
                uplink.SteadyThrows = true;
                foreach (var ut in new[] { 10.0, 20.0, 30.0 })
                {
                    engine.TickAndWait(ut, CounterProbeUplink.Snapshot(), Timeout);
                }

                var steady = (await RosterAsync(client))[CounterProbeUplink.SteadyTopic];

                Assert.False(Flag(steady, "available"));
                Assert.True(Flag(steady, "born"));
                Assert.Equal(1L, Count(steady, "considered"));
                Assert.Equal(1L, Count(steady, "emitted"));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The roster is complete: a channel nobody ever subscribed to is
        /// PRESENT with a zero subscriber count, never omitted. An omitted row
        /// would be indistinguishable from a channel that was never declared,
        /// which is the ambiguity this Topic exists to remove, and it would
        /// remove it for the ONE channel most likely to be under investigation:
        /// the quiet one.
        /// </summary>
        [Fact]
        public async Task TheRosterCarriesEveryDeclaredChannelIncludingTheUnsubscribedOnes()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CounterProbeUplink());
            engine.SetChannelCounterIntervalForTests(0);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.ChannelsTopic, Timeout);
                engine.TickAndWait(0.0, CounterProbeUplink.Snapshot(), Timeout);

                var rows = await RosterAsync(client);

                Assert.Contains(CounterProbeUplink.SteadyTopic, rows.Keys);
                Assert.Contains(CounterProbeUplink.SilentTopic, rows.Keys);
                Assert.Contains(CounterProbeUplink.UnwatchedTopic, rows.Keys);
                // The engine's own diagnostic channels are declared like any
                // other and appear alongside them.
                Assert.Contains(ChannelEngine.UplinksTopic, rows.Keys);

                // Sorted, so two captures diff row for row.
                var topics = rows.Keys.ToList();
                Assert.Equal(topics.OrderBy(t => t, StringComparer.Ordinal).ToList(), topics);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The report counts itself, and says so: <c>system.channels</c> is a
        /// declared, tick-mapped channel, so it carries its own row. Its own
        /// numbers are behind the frame they arrive in, because the row is built
        /// by the mapper that runs before the engine's Decide call for it, and
        /// this pins that rather than leaving a reader to discover it.
        /// </summary>
        [Fact]
        public async Task TheRosterCountsItselfAndIsOneConsiderationBehind()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CounterProbeUplink());
            engine.SetChannelCounterIntervalForTests(0);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.ChannelsTopic, Timeout);

                foreach (var ut in new[] { 0.0, 10.0, 20.0 })
                {
                    engine.TickAndWait(ut, CounterProbeUplink.Snapshot(), Timeout);
                }

                var self = (await RosterAsync(client))[ChannelEngine.ChannelsTopic];

                Assert.Equal(1L, Count(self, "subscribers"));
                Assert.True(Flag(self, "tickMapped"));
                // Three ticks were considered by the time the third frame left,
                // and the row in it can only know about the first two.
                Assert.Equal(2L, Count(self, "considered"));
                Assert.Equal(3L, engine.ChannelCounters(ChannelEngine.ChannelsTopic).Considered);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// Drains until a roster frame has arrived and then gone quiet, rather
        /// than draining once and assuming one landed inside the window. The
        /// frames are all emitted server-side before the last
        /// <c>TickAndWait</c> returns, so what is being waited on is only the
        /// outbox pump reaching the wire: fast, but not instant on a loaded
        /// machine, and a single quiet window that expired first read as an
        /// empty capture. Bounded by <see cref="Timeout"/> so a genuinely
        /// missing frame still fails rather than hanging.
        /// </summary>
        private static async Task<Dictionary<string, IDictionary<string, object?>>> RosterAsync(TestClient client)
        {
            var frames = new List<StreamData<object?>>();
            var deadline = DateTime.UtcNow + Timeout;
            while (DateTime.UtcNow < deadline)
            {
                frames.AddRange(await DrainAllStreamDataAsync(client, Quiet));
                if (frames.Any(f => f.Topic == ChannelEngine.ChannelsTopic))
                {
                    return RowsFrom(frames);
                }
            }
            Assert.Fail("no " + ChannelEngine.ChannelsTopic + " frame arrived");
            return null!;
        }

        private static Dictionary<string, IDictionary<string, object?>> RowsFrom(
            IEnumerable<StreamData<object?>> frames)
        {
            var last = frames.LastOrDefault(f => f.Topic == ChannelEngine.ChannelsTopic);
            Assert.NotNull(last);

            var payload = Assert.IsAssignableFrom<IDictionary<string, object?>>(last!.Payload);
            var channels = Assert.IsAssignableFrom<IEnumerable<object?>>(payload["channels"]);

            var rows = new Dictionary<string, IDictionary<string, object?>>(StringComparer.Ordinal);
            foreach (var raw in channels)
            {
                var row = Assert.IsAssignableFrom<IDictionary<string, object?>>(raw);
                rows[Convert.ToString(row["topic"]) ?? ""] = row;
            }
            return rows;
        }

        private static long Count(IDictionary<string, object?> row, string field) =>
            Convert.ToInt64(row[field]);

        private static bool Flag(IDictionary<string, object?> row, string field) =>
            Convert.ToBoolean(row[field]);

        /// <summary>
        /// Three channels, one per reading the roster has to be able to give:
        /// a value that never changes, a mapper that never produces one, and a
        /// channel nobody watches. The keyframe interval is deliberately far
        /// longer than any test's UT span, so the only keyframe any of them ever
        /// gets is the subscribe-forced one and a climbing <c>emitted</c> would
        /// mean the change-gate let a repeat through.
        /// </summary>
        private sealed class CounterProbeUplink : ISitrepUplink
        {
            public const string SteadyTopic = "counters.steady";
            public const string SilentTopic = "counters.silent";
            public const string UnwatchedTopic = "counters.unwatched";

            public bool SteadyThrows { get; set; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-counter-probe",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Declare(SteadyTopic),
                    Declare(SilentTopic),
                    Declare(UnwatchedTopic),
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(SteadyTopic, _ =>
                {
                    if (SteadyThrows)
                    {
                        throw new InvalidOperationException("boom -- the steady mapper throws");
                    }
                    return 1.0;
                });
                // Null every tick, never opting into AbsenceIsData: the birth
                // gate holds this short of the emitter forever.
                host.AddChannelSource(SilentTopic, _ => null);
                host.AddChannelSource(UnwatchedTopic, _ => 2.0);
            }

            public static KspSnapshot Snapshot() => new KspSnapshot
            {
                Values = new Dictionary<string, object?>(),
            };

            private static ChannelDeclaration Declare(string topic) => new ChannelDeclaration
            {
                Topic = topic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 100_000, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.TrueNow,
            };
        }
    }
}
