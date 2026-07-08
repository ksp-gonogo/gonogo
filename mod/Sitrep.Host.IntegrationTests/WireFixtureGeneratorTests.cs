using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Xunit;
using Xunit.Abstractions;

using static Sitrep.Host.IntegrationTests.WsTestHarness;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// M2 end-to-end SDK validation, C# half: replays the REAL 7.5&#160;MB
    /// reference capture (<c>local_docs/telemetry-mod/recordings/reference-session-2026-07-07.json</c>,
    /// gitignored/local-only -- same skip-cleanly contract as
    /// <see cref="MilestoneReplayEndToEndTests"/>) through the exact same
    /// <see cref="ReplayKspHost"/> -&gt; <see cref="ChannelEngine"/> pipeline
    /// (<see cref="TestSystemExtension"/> + <see cref="TestVesselExtension"/>
    /// registered, zero network delay), but instead of asserting on the
    /// stream in-process, CAPTURES every raw wire frame for the FULL set of
    /// channels the vessel + system uplinks serve (<c>vessel.identity</c>,
    /// <c>vessel.orbit</c>, <c>vessel.flight</c>, <c>vessel.attitude</c>,
    /// <c>vessel.resources</c>, <c>vessel.thermal</c>, <c>vessel.control</c>,
    /// <c>vessel.comms</c>, <c>vessel.propulsion</c>, <c>vessel.maneuver</c>,
    /// <c>vessel.target</c>, <c>vessel.crew</c>, <c>vessel.structure</c>,
    /// <c>system.bodies</c>, <c>time.warp</c> -- fifteen channels total, grown
    /// from an original six-channel set that left the fixture too thin to
    /// catch a wrong mapping on any channel outside it, e.g. the
    /// <c>vessel.resources</c> flat-path bug M3 batch 1 found the hard way)
    /// -- exactly the raw JSON text a real <c>ClientWebSocket</c> received,
    /// byte-for-byte -- to a JSON fixture at
    /// <c>local_docs/telemetry-mod/recordings/reference-wire-fixture.json</c>
    /// (also gitignored -- <c>local_docs/</c> is blanket-ignored -- so this
    /// fixture is regenerated on demand, never committed).
    ///
    /// The TS half of this milestone (<c>packages/sitrep-client</c>'s
    /// <c>reference-wire-fixture.test.ts</c>) loads this file and replays the
    /// frames through a real <c>TelemetryClient</c>/<c>TimelineStore</c>,
    /// proving the FULL SDK -- derived channels, epoch/ghost handling,
    /// staleness/certainty -- against genuine engine output, not a hand-built
    /// fixture. Since <see cref="EnvelopeCodec"/>'s field order is asserted
    /// byte-for-byte identical to what the real TS SDK serializes (see this
    /// class's own doc comment reference to
    /// <c>EnvelopeSerializationGoldenFixtureTests</c>), each captured raw
    /// string here is exactly what <c>JSON.parse</c> on the TS side would
    /// receive from a live connection to this same engine.
    /// </summary>
    public class WireFixtureGeneratorTests
    {
        private readonly ITestOutputHelper _output;

        public WireFixtureGeneratorTests(ITestOutputHelper output)
        {
            _output = output;
        }

        private const string RecordingFileName = "reference-session-2026-07-07.json";
        private const string FixtureFileName = "reference-wire-fixture.json";
        private static readonly TimeSpan TickTimeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan ReaderPollTimeout = TimeSpan.FromSeconds(2);
        private static readonly TimeSpan FinalDrainDelay = TimeSpan.FromMilliseconds(750);

        private static string RecordingsDir([CallerFilePath] string sourceFilePath = "")
        {
            // mod/Sitrep.Host.IntegrationTests/WireFixtureGeneratorTests.cs ->
            // repo root is two levels up, same idiom as
            // MilestoneReplayEndToEndTests.RecordingPath.
            var testDir = Path.GetDirectoryName(sourceFilePath)!;
            return Path.Combine(testDir, "..", "..", "local_docs", "telemetry-mod", "recordings");
        }

        private static string RecordingPath() => Path.Combine(RecordingsDir(), RecordingFileName);

        private static string FixtureOutputPath() => Path.Combine(RecordingsDir(), FixtureFileName);

        [Fact]
        public async Task GeneratesReferenceWireFixtureFromRealRecordingForSdkValidation()
        {
            var recordingPath = RecordingPath();
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine(
                    $"SKIPPING: reference recording not found at \"{recordingPath}\" — it is a gitignored " +
                    "local-only asset (local_docs/ per CLAUDE.md), never present in CI. This is not a failure.");
                return;
            }

            var json = System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath));
            var session = RecordedSessionCodec.Parse(json);
            _output.WriteLine($"Reference recording found: {session.Entries.Count} entries.");

            // The full set the vessel + system uplinks serve -- every
            // vessel.* channel plus the two context channels -- so the TS-side
            // golden dual-run has real recorded frames to validate EVERY
            // widget's mapping against, not just the six that happened to be
            // wired up when this generator was first written. A channel
            // absent here can't catch a wrong/flat-vs-nested field mapping
            // (see class doc comment).
            var topics = new[]
            {
                VesselViewProvider.IdentityTopic,
                VesselViewProvider.OrbitTopic,
                VesselViewProvider.FlightTopic,
                VesselViewProvider.AttitudeTopic,
                VesselViewProvider.ResourcesTopic,
                VesselViewProvider.ThermalTopic,
                VesselViewProvider.ControlTopic,
                VesselViewProvider.CommsTopic,
                VesselViewProvider.PropulsionTopic,
                VesselViewProvider.ManeuverTopic,
                VesselViewProvider.TargetTopic,
                VesselViewProvider.CrewTopic,
                VesselViewProvider.StructureTopic,
                SystemViewProvider.Topic,
                VesselViewProvider.WarpTopic,
            };
            var topicSet = new HashSet<string>(topics);

            var frames = new List<string>();
            var epochsSeen = new HashSet<int>();
            var rewindCount = 0;

            using var server = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0.0);
            server.RegisterUplink(new TestSystemExtension());
            server.RegisterUplink(new TestVesselExtension());
            server.Start();

            try
            {
                var replay = new ReplayKspHost(session);
                var lifecycleEvents = new List<KspLifecycleEvent>();
                replay.Lifecycle += lifecycleEvents.Add;

                await using var client = await TestClient.ConnectAsync(server.BoundPort, TickTimeout);
                foreach (var topic in topics)
                {
                    await SubscribeAsync(client, topic, TickTimeout);
                }

                using var readerCts = new CancellationTokenSource();
                var reader = Task.Run(async () =>
                {
                    while (!readerCts.IsCancellationRequested)
                    {
                        string raw;
                        try
                        {
                            raw = await client.ReceiveAsync(ReaderPollTimeout);
                        }
                        catch (OperationCanceledException)
                        {
                            continue;
                        }

                        object parsed;
                        try
                        {
                            parsed = EnvelopeCodec.ParseServerMessage(raw);
                        }
                        catch (Exception)
                        {
                            continue;
                        }

                        string? frameTopic = parsed switch
                        {
                            StreamData sd => sd.Topic,
                            EventMsg evt => evt.Topic,
                            _ => null,
                        };
                        if (frameTopic == null || !topicSet.Contains(frameTopic))
                        {
                            continue;
                        }

                        int epoch = parsed switch
                        {
                            StreamData sd => sd.Meta.TimelineEpoch,
                            EventMsg evt => evt.Meta.TimelineEpoch,
                            _ => 0,
                        };
                        epochsSeen.Add(epoch);
                        frames.Add(raw);
                    }
                });

                // Drive the WHOLE replay, one recorded entry at a time --
                // same tick-only-on-snapshot-steps rule as
                // MilestoneReplayEndToEndTests.RunPassAsync.
                double? lastTickUt = null;
                while (true)
                {
                    var lifecycleCountBefore = lifecycleEvents.Count;
                    if (!replay.Step())
                    {
                        break;
                    }

                    if (lifecycleEvents.Count > lifecycleCountBefore)
                    {
                        continue;
                    }

                    var ut = replay.NowUt();
                    if (lastTickUt.HasValue && ut < lastTickUt.Value)
                    {
                        rewindCount++;
                    }
                    lastTickUt = ut;

                    server.TickAndWait(ut, replay.Sample(), TickTimeout);
                }

                await Task.Delay(FinalDrainDelay);
                readerCts.Cancel();
                try
                {
                    await reader;
                }
                catch (Exception)
                {
                    // best-effort drain only
                }
            }
            finally
            {
                server.Stop();
            }

            Assert.Equal(3, rewindCount);
            Assert.True(frames.Count > 0, "expected at least one captured wire frame across the requested topics");
            Assert.Equal(new HashSet<int> { 0, 1, 2, 3 }, epochsSeen);
            Assert.Equal(topics.Length, topics.Distinct().Count());
            var capturedTopics = new HashSet<string>(frames
                .Select(raw => EnvelopeCodec.ParseServerMessage(raw))
                .Select(parsed => parsed switch
                {
                    StreamData sd => sd.Topic,
                    EventMsg evt => evt.Topic,
                    _ => null,
                })
                .Where(t => t != null)!);
            Assert.True(
                topicSet.SetEquals(capturedTopics),
                "expected the fixture to carry frames for every one of the requested topics; " +
                $"missing: {string.Join(", ", topicSet.Except(capturedTopics))}");

            var fixture = new WireFixture
            {
                GeneratedAtUtc = DateTime.UtcNow.ToString("o"),
                RecordingFile = RecordingFileName,
                RecordingEntries = session.Entries.Count,
                NetworkDelaySeconds = 0.0,
                SubscribedTopics = topics,
                FrameCount = frames.Count,
                EpochsSeen = epochsSeen.OrderBy(e => e).ToArray(),
                Frames = frames.ToArray(),
            };

            var outputPath = FixtureOutputPath();
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            var fixtureJson = JsonSerializer.Serialize(
                fixture,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            // BOM-less UTF-8 (System.Text.Encoding.UTF8 writes a BOM by
            // default) — Node's JSON.parse does not strip a leading BOM and
            // would throw on it; the TS-side fixture test reads this file
            // straight through JSON.parse.
            File.WriteAllText(outputPath, fixtureJson, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

            _output.WriteLine(
                $"Wrote wire fixture to \"{outputPath}\": {frames.Count} frames across topics " +
                $"{string.Join(", ", topics)}; epochs {{{string.Join(",", fixture.EpochsSeen)}}}; " +
                $"{rewindCount} rewinds detected.");
        }

        /// <summary>Serialization shape of the fixture file — see this class's own doc comment.</summary>
        private sealed class WireFixture
        {
            public string GeneratedAtUtc { get; set; } = "";
            public string RecordingFile { get; set; } = "";
            public int RecordingEntries { get; set; }
            public double NetworkDelaySeconds { get; set; }
            public string[] SubscribedTopics { get; set; } = Array.Empty<string>();
            public int FrameCount { get; set; }
            public int[] EpochsSeen { get; set; } = Array.Empty<int>();

            /// <summary>
            /// Each element is the EXACT raw wire text of one captured frame
            /// (a JSON-encoded string containing JSON) — not re-parsed/
            /// re-serialized objects — so the TS side reads byte-for-byte
            /// what a live connection would have delivered.
            /// </summary>
            public string[] Frames { get; set; } = Array.Empty<string>();
        }
    }
}
