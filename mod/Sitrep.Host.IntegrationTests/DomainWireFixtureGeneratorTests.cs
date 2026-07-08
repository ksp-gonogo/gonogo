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
    /// Sibling to <see cref="WireFixtureGeneratorTests"/> — same
    /// <see cref="ReplayKspHost"/> -&gt; <see cref="ChannelEngine"/> ->
    /// real <c>ClientWebSocket</c> pipeline, same raw-wire-frame capture
    /// idiom, but replaying FOUR newly captured recordings that each carry
    /// data the original 2026-07-07 reference session lacks (maneuver node
    /// ids, a live docking approach, populated career/facility/strategy
    /// state, and a real comms connected/disconnected/reconnected
    /// transition) into their OWN per-domain fixtures. Deliberately a
    /// SEPARATE file/class from <see cref="WireFixtureGeneratorTests"/> so
    /// that class — and the existing
    /// <c>local_docs/telemetry-mod/recordings/reference-wire-fixture.json</c>
    /// it produces, which a parallel migration batch's TS tests already
    /// depend on — is never touched by this addition.
    ///
    /// <para>All four recordings and generated fixtures are gitignored/
    /// local-only (<c>local_docs/</c> is blanket-ignored), same posture as
    /// the original generator: regenerated on demand by running this test
    /// class, never committed.</para>
    /// </summary>
    public class DomainWireFixtureGeneratorTests
    {
        private readonly ITestOutputHelper _output;

        public DomainWireFixtureGeneratorTests(ITestOutputHelper output)
        {
            _output = output;
        }

        private static readonly TimeSpan TickTimeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan ReaderPollTimeout = TimeSpan.FromSeconds(2);
        private static readonly TimeSpan FinalDrainDelay = TimeSpan.FromMilliseconds(750);

        private static string RecordingsDir([CallerFilePath] string sourceFilePath = "")
        {
            var testDir = Path.GetDirectoryName(sourceFilePath)!;
            return Path.Combine(testDir, "..", "..", "local_docs", "telemetry-mod", "recordings");
        }

        [Fact]
        public async Task GeneratesManeuverWireFixtureFromManeuveringRecording()
        {
            const string recordingFileName = "reference-maneuver-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-maneuver.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[]
            {
                VesselViewProvider.ManeuverTopic,
                VesselViewProvider.TargetTopic,
                VesselViewProvider.OrbitTopic,
                VesselViewProvider.IdentityTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepExtension[] { new TestVesselExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var maneuverFrames = ParsePayloads(capture.Frames, VesselViewProvider.ManeuverTopic);
            Assert.True(maneuverFrames.Count > 0, "expected at least one vessel.maneuver frame");

            var nodeIds = maneuverFrames
                .SelectMany(p => (p.TryGetValue("nodes", out var raw) ? raw as IEnumerable<object?> : null) ?? Array.Empty<object?>())
                .OfType<IDictionary<string, object?>>()
                .Select(n => n.TryGetValue("id", out var id) ? id as string : null)
                .Where(id => !string.IsNullOrEmpty(id))
                .ToList();
            Assert.True(nodeIds.Count > 0, "expected at least one maneuver node carrying a real (non-empty) id");

            var targetFrames = ParsePayloads(capture.Frames, VesselViewProvider.TargetTopic);
            Assert.True(targetFrames.Count > 0, "expected at least one vessel.target frame");
            Assert.Contains(targetFrames, t => (t.TryGetValue("name", out var name) ? name as string : null) == "Mun");

            _output.WriteLine($"maneuver fixture: {maneuverFrames.Count} vessel.maneuver frames, {nodeIds.Count} node-id occurrences, {targetFrames.Count} vessel.target frames.");
            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesDockWireFixtureFromDockingRecording()
        {
            const string recordingFileName = "reference-dock-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-dock.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[]
            {
                VesselViewProvider.DockTopic,
                VesselViewProvider.TargetTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepExtension[] { new TestVesselExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var dockFrames = ParsePayloads(capture.Frames, VesselViewProvider.DockTopic);
            Assert.True(dockFrames.Count > 0, "expected at least one vessel.dock frame");
            Assert.Contains(dockFrames, d => d.TryGetValue("forwardDot", out var fd) && fd is double);

            _output.WriteLine($"dock fixture: {dockFrames.Count} vessel.dock frames.");
            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesCareerWireFixtureFromCareerRecording()
        {
            const string recordingFileName = "reference-career-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-career.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[] { CareerViewProvider.Topic };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepExtension[] { new TestCareerExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var careerFrames = ParsePayloads(capture.Frames, CareerViewProvider.Topic);
            Assert.True(careerFrames.Count > 0, "expected at least one career.status frame");

            Assert.Contains(careerFrames, c =>
                c.TryGetValue("economy", out var econ) &&
                econ is IDictionary<string, object?> econDict &&
                econDict.TryGetValue("funds", out var funds) &&
                funds is double);

            Assert.Contains(careerFrames, c =>
                c.TryGetValue("facilities", out var fac) &&
                fac is IDictionary<string, object?> facDict &&
                facDict.Values.OfType<IDictionary<string, object?>>()
                    .Any(f => f.TryGetValue("upgradeCost", out var cost) && cost is double));

            Assert.Contains(careerFrames, c =>
                c.TryGetValue("strategies", out var strat) &&
                strat is IDictionary<string, object?> stratDict &&
                stratDict.TryGetValue("active", out var active) &&
                active is IEnumerable<object?> activeList &&
                activeList.OfType<IDictionary<string, object?>>()
                    .Any(s => !string.IsNullOrEmpty(s.TryGetValue("title", out var title) ? title as string : null)));

            _output.WriteLine($"career fixture: {careerFrames.Count} career.status frames.");
            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesCommsWireFixtureFromCommsTransitionRecording()
        {
            const string recordingFileName = "reference-comms-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-comms.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[] { VesselViewProvider.CommsTopic };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepExtension[] { new TestVesselExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var commsStream = ParseStreamFrames(capture.Frames, VesselViewProvider.CommsTopic);
            Assert.True(commsStream.Count > 0, "expected at least one vessel.comms frame");

            // ChannelEngine's own doc comment (see ChannelEngine.cs around the
            // "born"/tombstone tracking): once a channel has emitted a
            // non-null value, a subsequent null mapper result emits exactly
            // ONE tombstone frame (present -> null), then null -> null is
            // suppressed. This recording's disconnection window is
            // represented as a live vessel.comms record with
            // connected:false/signalStrength:0 the whole time -- the comms
            // GROUP itself never goes absent again after the vessel is born
            // -- so no present -> null tombstone is expected from the
            // True -> False -> True window itself; only the "connected"
            // boolean flips inside an always-present payload. Recorded here
            // for the SDK absence-model design: don't wait for a null
            // payload to detect signal loss on this channel, watch
            // `connected`.
            var connectedSequence = commsStream
                .Select(sd => sd.Payload is IDictionary<string, object?> p && p.TryGetValue("connected", out var c) && c is bool b ? (bool?)b : null)
                .ToList();

            var sawTrue1 = false;
            var sawFalse = false;
            var sawTrue2 = false;
            foreach (var connected in connectedSequence)
            {
                if (!sawTrue1 && connected == true)
                {
                    sawTrue1 = true;
                }
                else if (sawTrue1 && !sawFalse && connected == false)
                {
                    sawFalse = true;
                }
                else if (sawFalse && !sawTrue2 && connected == true)
                {
                    sawTrue2 = true;
                }
            }
            Assert.True(sawTrue1 && sawFalse && sawTrue2, "expected a connected True -> False -> True sequence across the captured vessel.comms frames");

            var tombstoneCount = commsStream.Count(sd => sd.Payload == null);
            _output.WriteLine($"comms fixture: {commsStream.Count} vessel.comms frames; True->False->True transition confirmed; {tombstoneCount} null-payload (tombstone) frames observed.");

            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesScienceWireFixtureFromScienceRecording()
        {
            const string recordingFileName = "reference-science-parts-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-science.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            // All three science.* channels, INCLUDING lab/deployed even
            // though this particular recording never populates them (no
            // science lab or Breaking Ground deployed experiment onboard).
            // Subscribing to them proves out ChannelEngine's own "born"
            // semantics (see its doc comment around _born): a channel whose
            // mapper NEVER returns a non-null value is never "born" and
            // therefore emits ZERO wire frames — not a tombstone, not a
            // null-payload keyframe, nothing at all. So a widget backed by
            // science.lab/deployed against THIS fixture will see silence
            // indistinguishable from "not subscribed", not an explicit
            // null/absent signal — asserted below rather than assumed.
            var topics = new[]
            {
                ScienceViewProvider.ExperimentsTopic,
                ScienceViewProvider.LabTopic,
                ScienceViewProvider.DeployedTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepExtension[] { new TestScienceExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            // ScienceViewProvider.BuildExperiments's payload IS the entry
            // list itself (see its doc comment / BuildList), not a wrapping
            // dict keyed "experiments" — same shape as parts.robotics below
            // — so parse the raw StreamData payloads rather than
            // ParsePayloads' IDictionary-only filter.
            var experimentsStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.ExperimentsTopic);
            Assert.True(experimentsStream.Count > 0, "expected at least one science.experiments frame");

            var experimentEntries = experimentsStream
                .SelectMany(sd => (sd.Payload as IEnumerable<object?>) ?? Array.Empty<object?>())
                .OfType<IDictionary<string, object?>>()
                .ToList();
            Assert.Contains(experimentEntries, e =>
                (e.TryGetValue("experimentId", out var id) ? id as string : null) == "mysteryGoo" &&
                !string.IsNullOrEmpty(e.TryGetValue("subjectId", out var subj) ? subj as string : null));

            var situations = experimentEntries
                .Select(e => e.TryGetValue("situation", out var s) ? s as string : null)
                .Where(s => !string.IsNullOrEmpty(s))
                .Distinct()
                .ToList();
            Assert.True(situations.Count >= 2, $"expected experiments across >=2 distinct situations, saw: {string.Join(", ", situations)}");

            var labStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.LabTopic);
            var deployedStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.DeployedTopic);
            Assert.True(labStream.Count == 0, "expected ZERO science.lab frames — this recording never carries a lab, so the channel is never 'born' (see ChannelEngine's _born doc comment) and should stay silent, not tombstone");
            Assert.True(deployedStream.Count == 0, "expected ZERO science.deployed frames — this recording never carries a deployed experiment, so the channel is never 'born' and should stay silent, not tombstone");

            _output.WriteLine(
                $"science fixture: {experimentsStream.Count} science.experiments frames, {experimentEntries.Count} experiment entries, " +
                $"situations {{{string.Join(",", situations)}}}; science.lab {labStream.Count} frames; " +
                $"science.deployed {deployedStream.Count} frames — both zero (never captured this session, channel never born) as expected.");

            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesLabWireFixtureFromLabRecording()
        {
            const string recordingFileName = "reference-lab-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-lab.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            // Sibling to GeneratesScienceWireFixtureFromScienceRecording above,
            // but replaying a session where a Mobile Processing Lab IS
            // onboard — OPERATIONAL and crewed (2 scientists) but IDLE (no
            // data loaded, dataStored/scienceRate both 0). Subscribes
            // science.lab + science.experiments (not deployed — this
            // recording carries no Breaking Ground ground experiment).
            var topics = new[]
            {
                ScienceViewProvider.LabTopic,
                ScienceViewProvider.ExperimentsTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepExtension[] { new TestScienceExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            // ScienceViewProvider.BuildLab's payload IS the entry list itself
            // (see BuildList), not a wrapping dict — parse the raw
            // StreamData payloads rather than ParsePayloads' IDictionary-only
            // filter, same as the science.experiments/parts.robotics channels
            // above.
            var labStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.LabTopic);
            Assert.True(labStream.Count > 0, "expected at least one science.lab frame");

            var labEntries = labStream
                .SelectMany(sd => (sd.Payload as IEnumerable<object?>) ?? Array.Empty<object?>())
                .OfType<IDictionary<string, object?>>()
                .ToList();
            // JsonReader (see its own doc comment) always parses numbers to
            // double regardless of the writer-side C# type — scientistCount
            // (int on the wire-build side) and dataStorage both come back as
            // double after the real wire round-trip, same as every other
            // numeric assertion in this file (career funds, dock forwardDot).
            Assert.Contains(labEntries, l =>
                (l.TryGetValue("isOperational", out var op) && op is bool opb && opb) &&
                (l.TryGetValue("scientistCount", out var sc) && sc is double scD && scD == 2) &&
                (l.TryGetValue("dataStorage", out var ds) && ds is double dsD && dsD == 750));

            var experimentsStream = ParseStreamFrames(capture.Frames, ScienceViewProvider.ExperimentsTopic);

            _output.WriteLine(
                $"lab fixture: {labStream.Count} science.lab frames, {labEntries.Count} lab entries " +
                $"(operational/2 scientists/750 storage confirmed); {experimentsStream.Count} science.experiments frames.");

            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        [Fact]
        public async Task GeneratesPartsWireFixtureFromPartsRecording()
        {
            const string recordingFileName = "reference-science-parts-2026-07-08.json";
            const string fixtureFileName = "reference-wire-fixture-parts.json";
            var recordingPath = Path.Combine(RecordingsDir(), recordingFileName);
            if (!File.Exists(recordingPath))
            {
                _output.WriteLine($"SKIPPING: reference recording not found at \"{recordingPath}\" — gitignored local-only asset, not present in CI.");
                return;
            }

            var session = RecordedSessionCodec.Parse(System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(recordingPath)));
            var topics = new[]
            {
                PartsViewProvider.PowerTopic,
                PartsViewProvider.RoboticsTopic,
            };

            var capture = await ReplayAndCaptureAsync(session, new ISitrepExtension[] { new TestPartsExtension() }, topics);
            Assert.True(capture.Frames.Count > 0, "expected at least one captured wire frame");

            var powerFrames = ParsePayloads(capture.Frames, PartsViewProvider.PowerTopic);
            Assert.True(powerFrames.Count > 0, "expected at least one parts.power frame");
            Assert.Contains(powerFrames, p => p.TryGetValue("totalProductionEc", out var tp) && tp is double);
            Assert.Contains(powerFrames, p =>
                p.TryGetValue("solarPanels", out var raw) &&
                raw is IEnumerable<object?> panels &&
                panels.OfType<IDictionary<string, object?>>().Any(sp => !string.IsNullOrEmpty(sp.TryGetValue("partName", out var pn) ? pn as string : null)));

            // parts.robotics's own payload IS the list (see PartsViewProvider.BuildRobotics
            // — it returns List<object?> directly, not a wrapping dict), so
            // ParsePayloads' IDictionary-only filter would yield nothing
            // useful for this channel; parse the raw StreamData payloads
            // instead.
            var roboticsStream = ParseStreamFrames(capture.Frames, PartsViewProvider.RoboticsTopic);
            Assert.True(roboticsStream.Count > 0, "expected at least one parts.robotics frame");
            var roboticsEntries = roboticsStream
                .SelectMany(sd => (sd.Payload as IEnumerable<object?>) ?? Array.Empty<object?>())
                .OfType<IDictionary<string, object?>>()
                .ToList();
            Assert.Contains(roboticsEntries, r => (r.TryGetValue("type", out var t) ? t as string : null) == "hinge");
            var rotorPresent = roboticsEntries.Any(r => (r.TryGetValue("type", out var t) ? t as string : null) == "rotor");

            _output.WriteLine(
                $"parts fixture: {powerFrames.Count} parts.power frames, {roboticsStream.Count} parts.robotics frames, " +
                $"{roboticsEntries.Count} servo entries; rotor present: {rotorPresent}.");

            WriteFixture(fixtureFileName, recordingFileName, session.Entries.Count, topics, capture);
        }

        // ----------------------------------------------------------------
        // Shared replay/capture/fixture-writing plumbing
        // ----------------------------------------------------------------

        private sealed record CaptureResult(List<string> Frames, HashSet<int> Epochs, int RewindCount);

        /// <summary>
        /// Same replay-and-capture idiom as
        /// <see cref="WireFixtureGeneratorTests.GeneratesReferenceWireFixtureFromRealRecordingForSdkValidation"/>,
        /// factored out so each of this class's four fixture tests doesn't
        /// hand-copy the ~80-line engine/client/reader/drive plumbing.
        /// </summary>
        private async Task<CaptureResult> ReplayAndCaptureAsync(
            RecordedSession session,
            IEnumerable<ISitrepExtension> extensions,
            string[] topics)
        {
            var topicSet = new HashSet<string>(topics);
            var frames = new List<string>();
            var epochsSeen = new HashSet<int>();
            var rewindCount = 0;

            using var server = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0.0);
            foreach (var extension in extensions)
            {
                server.RegisterExtension(extension);
            }
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

            return new CaptureResult(frames, epochsSeen, rewindCount);
        }

        /// <summary>Parses every captured frame for <paramref name="topic"/>, returning only the non-null <c>StreamData</c> payload dictionaries — the common case for "does this domain's data actually look right" assertions.</summary>
        private static List<IDictionary<string, object?>> ParsePayloads(IEnumerable<string> frames, string topic)
        {
            var result = new List<IDictionary<string, object?>>();
            foreach (var raw in frames)
            {
                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData sd && sd.Topic == topic && sd.Payload is IDictionary<string, object?> payload)
                {
                    result.Add(payload);
                }
            }
            return result;
        }

        /// <summary>Parses every captured frame for <paramref name="topic"/> into its raw <c>StreamData</c>, INCLUDING null-payload (tombstone) frames — needed for the comms present/absent transition assertion, where a null payload is itself meaningful.</summary>
        private static List<StreamData> ParseStreamFrames(IEnumerable<string> frames, string topic)
        {
            var result = new List<StreamData>();
            foreach (var raw in frames)
            {
                if (EnvelopeCodec.ParseServerMessage(raw) is StreamData sd && sd.Topic == topic)
                {
                    result.Add(sd);
                }
            }
            return result;
        }

        /// <summary>Serialization shape mirrors <see cref="WireFixtureGeneratorTests"/>'s private <c>WireFixture</c> — duplicated (not shared) so this file never needs to touch that class.</summary>
        private sealed class WireFixture
        {
            public string GeneratedAtUtc { get; set; } = "";
            public string RecordingFile { get; set; } = "";
            public int RecordingEntries { get; set; }
            public double NetworkDelaySeconds { get; set; }
            public string[] SubscribedTopics { get; set; } = Array.Empty<string>();
            public int FrameCount { get; set; }
            public int[] EpochsSeen { get; set; } = Array.Empty<int>();
            public string[] Frames { get; set; } = Array.Empty<string>();
        }

        private void WriteFixture(string fixtureFileName, string recordingFileName, int recordingEntries, string[] topics, CaptureResult capture)
        {
            var fixture = new WireFixture
            {
                GeneratedAtUtc = DateTime.UtcNow.ToString("o"),
                RecordingFile = recordingFileName,
                RecordingEntries = recordingEntries,
                NetworkDelaySeconds = 0.0,
                SubscribedTopics = topics,
                FrameCount = capture.Frames.Count,
                EpochsSeen = capture.Epochs.OrderBy(e => e).ToArray(),
                Frames = capture.Frames.ToArray(),
            };

            var outputPath = Path.Combine(RecordingsDir(), fixtureFileName);
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            var fixtureJson = JsonSerializer.Serialize(
                fixture,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            // BOM-less UTF-8, same rationale as WireFixtureGeneratorTests: the
            // TS-side fixture tests read this straight through JSON.parse,
            // which does not strip a leading BOM.
            File.WriteAllText(outputPath, fixtureJson, new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

            _output.WriteLine(
                $"Wrote wire fixture to \"{outputPath}\": {capture.Frames.Count} frames across topics " +
                $"{string.Join(", ", topics)}; epochs {{{string.Join(",", fixture.EpochsSeen)}}}; " +
                $"{capture.RewindCount} rewinds detected.");
        }
    }
}
