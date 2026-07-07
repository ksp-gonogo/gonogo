using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
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
    /// M1 Task 4a — the MILESTONE-level end-to-end replay validation: the
    /// WHOLE M1 pipeline (<see cref="ReplayKspHost"/> -&gt;
    /// <see cref="ChannelEngine"/>, BOTH <see cref="TestSystemExtension"/>
    /// (the KSP-free replica of <c>Gonogo.KSP.SystemExtension</c>) AND
    /// <see cref="TestVesselExtension"/> (the KSP-free replica of
    /// <c>Gonogo.KSP.VesselExtension</c>) registered together -- 16 declared
    /// channels, 17 declared commands, exactly as production wires them)
    /// driven by the REAL 7.5&#160;MB reference capture
    /// (<c>local_docs/telemetry-mod/recordings/reference-session-2026-07-07.json</c>,
    /// gitignored/local-only -- see <see cref="ReferenceRecordingReplayTests"/>'s
    /// doc comment for the same skip-cleanly contract this test follows),
    /// through a real <see cref="System.Net.WebSockets.ClientWebSocket"/>.
    ///
    /// Where the per-task tests (<see cref="ReferenceRecordingReplayTests"/>
    /// in <c>Sitrep.Host.Tests</c>) already prove each CHANNEL's mapper logic
    /// against this same recording by calling <c>VesselViewProvider.Build*</c>
    /// directly, this test proves the FULL WIRE PIPELINE end to end -- mapper
    /// -&gt; <see cref="ChannelEngine"/>'s change-gate/emitter -&gt; the
    /// Courier's delay model -&gt; the transport -&gt; a real client -- for
    /// every one of those channels at once, across the whole session,
    /// including the delay model and the 3 quickload UT-rewinds together
    /// (rather than one concern in isolation).
    ///
    /// Runs the recording through <see cref="ChannelEngine"/> TWICE:
    /// once with zero network delay (proves passthrough: <c>deliveredAt ==
    /// validAt</c>) and once with a 5s one-way delay (proves
    /// <c>deliveredAt == validAt + 5</c>) -- see <see cref="RunPassAsync"/>.
    /// </summary>
    public class MilestoneReplayEndToEndTests
    {
        private readonly ITestOutputHelper _output;

        public MilestoneReplayEndToEndTests(ITestOutputHelper output)
        {
            _output = output;
        }

        private const string RecordingFileName = "reference-session-2026-07-07.json";
        private static readonly TimeSpan TickTimeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan ReaderPollTimeout = TimeSpan.FromSeconds(2);
        private static readonly TimeSpan FinalDrainDelay = TimeSpan.FromMilliseconds(750);

        private static string RecordingPath([CallerFilePath] string sourceFilePath = "")
        {
            // mod/Sitrep.Host.IntegrationTests/MilestoneReplayEndToEndTests.cs ->
            // repo root is two levels up (mod/Sitrep.Host.IntegrationTests -> mod -> repo root),
            // same idiom as Sitrep.Host.Tests/ReferenceRecordingReplayTests.cs.
            var testDir = Path.GetDirectoryName(sourceFilePath)!;
            return Path.Combine(testDir, "..", "..", "local_docs", "telemetry-mod", "recordings", RecordingFileName);
        }

        [Fact]
        public async Task FullPipelineReplayValidatesAllChannelsDelayAndRewindWithNoWartsAcrossWholeSession()
        {
            var path = RecordingPath();
            if (!File.Exists(path))
            {
                _output.WriteLine(
                    $"SKIPPING: reference recording not found at \"{path}\" — it is a gitignored " +
                    "local-only asset (local_docs/ per CLAUDE.md), never present in CI. This is not a failure.");
                return;
            }

            var json = System.Text.Encoding.UTF8.GetString(File.ReadAllBytes(path));
            var session = RecordedSessionCodec.Parse(json);
            _output.WriteLine($"Reference recording found: {session.Entries.Count} entries.");

            // All 16 channels this milestone must prove: VesselExtension's 15
            // (vessel.* + time.warp) plus SystemExtension's system.bodies.
            var topics = VesselViewProvider.Topics.Concat(new[] { SystemViewProvider.Topic }).ToArray();
            Assert.Equal(16, topics.Length);

            // ---- Builder-level ballpark counts for maneuver/target -- done
            // directly against VesselViewProvider.Build* (independent of the
            // engine's lossy-latest wire coalescing, which would otherwise
            // undercount how many times the RAW recording actually carried
            // real maneuver-node/target data) -- same technique
            // ReferenceRecordingReplayTests' Task 2 test already uses. ----
            var (maneuverEmissions, maneuverWithNodes, targetEmissions) = CountManeuverAndTargetEmissions(session);
            Assert.True(maneuverWithNodes > 150, $"expected vessel.maneuver-with-nodes ballpark ~281 per the recording manifest, saw {maneuverWithNodes}");
            Assert.True(targetEmissions > 50, $"expected vessel.target ballpark ~110 per the recording manifest, saw {targetEmissions}");
            _output.WriteLine(
                $"Builder-level ballpark: {maneuverEmissions} vessel.maneuver emissions ({maneuverWithNodes} with queued nodes), " +
                $"{targetEmissions} vessel.target emissions.");

            // ---- PASS 1: delay=0 passthrough -- the primary full-pipeline
            // proof: every channel, the 3 rewinds, the 26 lifecycle events,
            // and the whole-session no-wart scan. ----
            var pass0 = await RunPassAsync(session, networkDelaySeconds: 0.0, topics);

            // ---- PASS 2: delay=5s on a FRESH replay of the SAME recording
            // -- proves delayed delivery end to end. ----
            var pass5 = await RunPassAsync(session, networkDelaySeconds: 5.0, topics);

            // ================= 1. every channel emits =================
            var missingFromPass0 = topics.Where(t => !pass0.SeenTopics.Contains(t)).ToList();
            var missingFromPass5 = topics.Where(t => !pass5.SeenTopics.Contains(t)).ToList();
            Assert.True(missingFromPass0.Count == 0, $"channels that never emitted (delay=0 pass): {string.Join(", ", missingFromPass0)}");
            Assert.True(missingFromPass5.Count == 0, $"channels that never emitted (delay=5 pass): {string.Join(", ", missingFromPass5)}");
            _output.WriteLine($"All {topics.Length} declared channels emitted at least once in both passes: {string.Join(", ", topics)}.");

            // ================= 2. delayed delivery end-to-end =================
            Assert.True(pass5.AllSamples.Count > 0, "expected at least one delivered sample in the delay=5 pass");
            foreach (var sample in pass5.AllSamples)
            {
                Assert.Equal(5.0, sample.Meta.DeliveredAt - sample.Meta.ValidAt, precision: 6);
            }
            Assert.True(pass0.AllSamples.Count > 0, "expected at least one delivered sample in the delay=0 pass");
            foreach (var sample in pass0.AllSamples)
            {
                Assert.Equal(0.0, sample.Meta.DeliveredAt - sample.Meta.ValidAt, precision: 6);
            }
            _output.WriteLine(
                $"Delayed delivery confirmed end-to-end: {pass5.AllSamples.Count} samples all carry deliveredAt-validAt == 5.0s " +
                $"(contrast: {pass0.AllSamples.Count} delay=0 samples all passthrough, deliveredAt == validAt).");

            // ================= 3. event/rewind stream =================
            Assert.Equal(3, pass0.RewindCount);
            Assert.Equal(3, pass5.RewindCount);
            Assert.True(pass0.TimelineResetEvents > 0, "expected at least one timeline-reset EventMsg (delay=0 pass)");
            Assert.True(pass5.TimelineResetEvents > 0, "expected at least one timeline-reset EventMsg (delay=5 pass)");
            Assert.Empty(pass0.GhostViolations);
            Assert.Empty(pass5.GhostViolations);
            Assert.Equal(26, pass0.LifecycleEventCount);
            Assert.Equal(26, pass5.LifecycleEventCount);
            _output.WriteLine(
                $"3 quickload UT-rewinds detected in both passes; {pass0.TimelineResetEvents} timeline-reset EventMsg(s) " +
                $"observed (delay=0 pass, {pass5.TimelineResetEvents} in delay=5 pass); no post-rewind ghost validAt observed " +
                $"in either pass; {pass0.LifecycleEventCount} lifecycle events fired (both passes).");

            // ================= 3b. Meta.TimelineEpoch (M2) =================
            // 3 rewinds -> 4 distinct timeline generations (0 pre-first-rewind,
            // then 1/2/3 after each of the 3 ResetTimeline calls) must show up
            // across the delivered samples' envelope Meta -- proving the
            // epoch is genuinely stamped end to end through the real wire
            // pipeline (Courier.MakeMeta), not just unit-tested in isolation.
            Assert.Equal(4, pass0.EpochsSeen.Count);
            Assert.Equal(4, pass5.EpochsSeen.Count);
            _output.WriteLine(
                $"Meta.timelineEpoch: {pass0.EpochsSeen.Count} distinct epochs observed (delay=0 pass), " +
                $"{pass5.EpochsSeen.Count} (delay=5 pass) -- matches the 3 rewinds (0/1/2/3).");

            // M2 fix-task defect C: the timeline-reset EventMsg itself must
            // ALSO carry the epoch it announces (not the wire default, 0,
            // regardless of how many rewinds already happened) -- 3 rewinds
            // must show up as epochs {1, 2, 3} across the reset events (0
            // never appears here: nothing is "reset" INTO epoch 0).
            var expectedResetEpochs = new HashSet<int> { 1, 2, 3 };
            Assert.Equal(expectedResetEpochs, pass0.TimelineResetEventEpochsSeen);
            Assert.Equal(expectedResetEpochs, pass5.TimelineResetEventEpochsSeen);
            _output.WriteLine(
                $"timeline-reset Meta.timelineEpoch: {{{string.Join(",", pass0.TimelineResetEventEpochsSeen.OrderBy(x => x))}}} " +
                "observed across both passes' reset events -- matches the 3 rewinds' epochs 1/2/3, not a flat 0.");

            // ================= 4. no-wart scan across the whole session =================
            Assert.Empty(pass0.WartViolations);
            Assert.Empty(pass5.WartViolations);
            Assert.True(pass0.VesselPayloadsWithSource > 0, "expected at least one vessel.* payload with meta.source stamped");
            Assert.Equal(0, pass0.VesselPayloadsMissingSource);
            Assert.Equal(0, pass5.VesselPayloadsMissingSource);
            _output.WriteLine(
                $"No-wart scan (NaN/Infinity/eccentricAnomaly/resource -1 sentinel) clean across " +
                $"{pass0.RawFrameCount + pass5.RawFrameCount} total wire frames (both passes); meta.source present on all " +
                $"{pass0.VesselPayloadsWithSource + pass5.VesselPayloadsWithSource} vessel.* payloads observed.");

            // ================= 5. M2 tombstones (finding-B fix) =================
            // The real recording has genuine present->null absence
            // transitions (e.g. target-clear moments) on several vessel.*
            // channels -- proving tombstones actually flow end to end
            // through the real engine/courier/wire pipeline, not just a
            // synthetic unit test. A null payload is a legitimate wire
            // sample (see ScanStreamDataForStructuredWarts), not a wart.
            Assert.True(pass0.VesselTombstoneCount > 0, "expected at least one real vessel.* tombstone (present->null) in the reference replay");
            Assert.True(pass5.VesselTombstoneCount > 0, "expected at least one real vessel.* tombstone (present->null) in the reference replay");
            _output.WriteLine(
                $"M2 tombstones: {pass0.VesselTombstoneCount} vessel.* present->null samples observed (delay=0 pass), " +
                $"{pass5.VesselTombstoneCount} (delay=5 pass).");
        }

        /// <summary>
        /// Drives the WHOLE recording through a fresh <see cref="ChannelEngine"/>
        /// (both <see cref="TestVesselExtension"/> and <see cref="TestSystemExtension"/>
        /// registered) with the given one-way network delay, subscribing a
        /// real <see cref="TestClient"/> to all 16 declared channels FIRST,
        /// then ticking snapshot-by-snapshot via <see cref="ChannelEngine.TickAndWait"/>
        /// (mirroring <c>ReplayToWebSocketEndToEndTests.DriveOneStep</c>'s
        /// skip-tick-on-lifecycle-event-step rule exactly) while a background
        /// reader task continuously drains and classifies every frame that
        /// reaches the wire -- StreamData samples (topic emission coverage,
        /// delay assertions, the no-wart scan) and EventMsg frames
        /// (timeline-reset, for the rewind/ghost check).
        /// </summary>
        private async Task<PassResult> RunPassAsync(RecordedSession session, double networkDelaySeconds, IReadOnlyList<string> topics)
        {
            var result = new PassResult();

            using var server = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds);
            server.RegisterExtension(new TestSystemExtension());
            server.RegisterExtension(new TestVesselExtension());
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

                // Per-topic bookkeeping for the "no post-rewind ghost" check
                // (see this class's doc comment): the watermark is the
                // highest validAt seen for a topic BEFORE its most recent
                // timeline-reset; the very next StreamData delivered for
                // that topic after the reset must be from the NEW (lower)
                // timeline, i.e. strictly below that watermark -- a real
                // ghost (the abandoned pre-rewind pending delivery M0.5
                // fixed) would arrive carrying the OLD high validAt instead.
                var watermarkBeforeReset = new Dictionary<string, double>();
                var awaitingGhostCheck = new Dictionary<string, bool>();
                foreach (var topic in topics)
                {
                    awaitingGhostCheck[topic] = false;
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

                        result.RawFrameCount++;
                        ScanRawFrameForWarts(raw, result);

                        object parsed;
                        try
                        {
                            parsed = EnvelopeCodec.ParseServerMessage(raw);
                        }
                        catch (Exception)
                        {
                            continue;
                        }

                        if (parsed is EventMsg evt)
                        {
                            if (evt.Name == "timeline-reset")
                            {
                                result.TimelineResetEvents++;
                                result.TimelineResetEventEpochsSeen.Add(evt.Meta.TimelineEpoch);
                                awaitingGhostCheck[evt.Topic] = true;
                            }
                            continue;
                        }

                        if (parsed is not StreamData streamData)
                        {
                            continue;
                        }

                        result.SeenTopics.Add(streamData.Topic);
                        result.AllSamples.Add(streamData);
                        result.EpochsSeen.Add(streamData.Meta.TimelineEpoch);

                        if (awaitingGhostCheck.TryGetValue(streamData.Topic, out var awaiting) && awaiting)
                        {
                            if (watermarkBeforeReset.TryGetValue(streamData.Topic, out var watermark) &&
                                streamData.Meta.ValidAt >= watermark)
                            {
                                result.GhostViolations.Add(
                                    $"topic \"{streamData.Topic}\": first post-reset validAt {streamData.Meta.ValidAt} " +
                                    $">= pre-reset watermark {watermark} — a stale/ghost sample from the abandoned timeline.");
                            }
                            awaitingGhostCheck[streamData.Topic] = false;
                        }

                        var currentWatermark = watermarkBeforeReset.TryGetValue(streamData.Topic, out var cur) ? cur : double.NegativeInfinity;
                        watermarkBeforeReset[streamData.Topic] = Math.Max(currentWatermark, streamData.Meta.ValidAt);

                        ScanStreamDataForStructuredWarts(streamData, result);
                    }
                });

                // ---- Drive the WHOLE replay, one recorded entry at a time.
                // Ticks the engine only for SNAPSHOT steps -- an event-only
                // step (detected by lifecycleEvents growing, exactly like
                // ReplayToWebSocketEndToEndTests.DriveOneStep) never ticks,
                // so the UT sequence the Courier/clock actually sees is the
                // 839 real snapshot UTs in capture order, unmodified. ----
                double? lastTickUt = null;
                var rewindCount = 0;
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

                result.RewindCount = rewindCount;
                result.LifecycleEventCount = lifecycleEvents.Count;

                // Let the outbox pump thread(s) drain whatever's left, then
                // stop the reader.
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

            return result;
        }

        /// <summary>
        /// No-wart scan over the RAW wire JSON text (before parsing) -- the
        /// most direct proof that these strings genuinely never reach the
        /// wire, matching how <see cref="ReferenceRecordingReplayTests"/>'s
        /// O-1 assertion scans <c>wireJson</c> directly. <see cref="Sitrep.Core.Serialization.JsonWriter"/>'s
        /// NaN/Infinity sentinel policy (see its own doc comment) means these
        /// should never appear; this is the regression guard proving that
        /// holds across the WHOLE real session, not just one hand-built
        /// sample.
        /// </summary>
        private static void ScanRawFrameForWarts(string raw, PassResult result)
        {
            if (raw.Contains("NaN") || raw.Contains("Infinity"))
            {
                result.WartViolations.Add($"raw frame contains a NaN/Infinity literal: {Truncate(raw)}");
            }
            if (raw.Contains("eccentricAnomaly"))
            {
                result.WartViolations.Add($"raw frame contains the eccentricAnomaly key (Telemachus copy-paste bug): {Truncate(raw)}");
            }
        }

        /// <summary>
        /// Structured checks that need the parsed payload rather than a raw
        /// text scan: the resource -1 sentinel (never legitimate per
        /// VesselViewProvider.BuildResources' R1 absence rule) and
        /// meta.source presence on every vessel.* payload.
        /// </summary>
        private static void ScanStreamDataForStructuredWarts(StreamData streamData, PassResult result)
        {
            if (streamData.Topic == VesselViewProvider.ResourcesTopic &&
                streamData.Payload is IDictionary<string, object?> resourcesPayload &&
                resourcesPayload.TryGetValue("resources", out var rawResources) &&
                rawResources is IDictionary<string, object?> resourceMap)
            {
                foreach (var kvp in resourceMap)
                {
                    if (kvp.Value is not IDictionary<string, object?> amount)
                    {
                        continue;
                    }
                    if (amount.TryGetValue("current", out var currentRaw) && currentRaw is double current && current == -1.0)
                    {
                        result.WartViolations.Add($"vessel.resources[\"{kvp.Key}\"].current == -1 sentinel");
                    }
                    if (amount.TryGetValue("max", out var maxRaw) && maxRaw is double max && max == -1.0)
                    {
                        result.WartViolations.Add($"vessel.resources[\"{kvp.Key}\"].max == -1 sentinel");
                    }
                }
            }

            if (streamData.Topic.StartsWith("vessel.", StringComparison.Ordinal))
            {
                if (streamData.Payload == null)
                {
                    // M2 tombstone (finding-B fix): a legitimate "no value"
                    // sample -- a present->null absence transition (e.g. the
                    // recording's target-clear moments, or a gap with no
                    // active vessel). There is no nested payload meta to
                    // check on an absent payload, so this is NOT a
                    // "missing source" wart -- count it separately so the
                    // scan can still positively prove real tombstones rode
                    // the actual wire pipeline in this milestone-level
                    // replay, rather than silently misclassifying them.
                    result.VesselTombstoneCount++;
                    return;
                }

                // NOTE: the ENVELOPE-level streamData.Meta.Source is always
                // ChannelEngine.NodeId ("system") -- see Courier.MakeMeta;
                // subject provenance ("vessel:<guid>") lives in the PAYLOAD's
                // own nested "meta" key instead (VesselViewProvider.ToWire(Meta),
                // embedded by every Build*Wire mapper). That nested value is
                // what this "meta.source present on every vessel payload"
                // check must inspect.
                string? nestedSource = null;
                if (streamData.Payload is IDictionary<string, object?> payloadDict &&
                    payloadDict.TryGetValue("meta", out var metaRaw) &&
                    metaRaw is IDictionary<string, object?> metaDict &&
                    metaDict.TryGetValue("source", out var sourceRaw))
                {
                    nestedSource = sourceRaw as string;
                }

                if (string.IsNullOrEmpty(nestedSource) || !nestedSource.StartsWith("vessel:", StringComparison.Ordinal))
                {
                    result.VesselPayloadsMissingSource++;
                }
                else
                {
                    result.VesselPayloadsWithSource++;
                }
            }
        }

        private static string Truncate(string s) => s.Length <= 300 ? s : s.Substring(0, 300) + "…";

        /// <summary>
        /// Builder-level maneuver/target emission counts against the SAME
        /// technique <see cref="ReferenceRecordingReplayTests"/>'s Task 2
        /// test uses, independent of the engine's lossy-latest wire
        /// coalescing (which would otherwise undercount how many raw
        /// snapshots actually carried maneuver-node/target data).
        /// </summary>
        private static (int maneuverEmissions, int maneuverWithNodes, int targetEmissions) CountManeuverAndTargetEmissions(RecordedSession session)
        {
            var replay = new ReplayKspHost(session);
            var maneuverEmissions = 0;
            var maneuverWithNodes = 0;
            var targetEmissions = 0;

            while (replay.Step())
            {
                var snapshot = replay.Sample();

                var maneuver = VesselViewProvider.BuildManeuver(snapshot);
                if (maneuver != null)
                {
                    maneuverEmissions++;
                    if (maneuver.Nodes.Count > 0)
                    {
                        maneuverWithNodes++;
                    }
                }

                var target = VesselViewProvider.BuildTarget(snapshot);
                if (target != null)
                {
                    targetEmissions++;
                }
            }

            return (maneuverEmissions, maneuverWithNodes, targetEmissions);
        }

        private sealed class PassResult
        {
            public readonly HashSet<string> SeenTopics = new HashSet<string>();
            public readonly List<StreamData> AllSamples = new List<StreamData>();
            public int RewindCount;
            public int TimelineResetEvents;
            public int LifecycleEventCount;
            public readonly List<string> GhostViolations = new List<string>();
            public readonly List<string> WartViolations = new List<string>();
            public int VesselPayloadsWithSource;
            public int VesselPayloadsMissingSource;
            public int VesselTombstoneCount;
            public int RawFrameCount;
            public readonly HashSet<int> EpochsSeen = new HashSet<int>();
            public readonly HashSet<int> TimelineResetEventEpochsSeen = new HashSet<int>();
        }
    }
}
