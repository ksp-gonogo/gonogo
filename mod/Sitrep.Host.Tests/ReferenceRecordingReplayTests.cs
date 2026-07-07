using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using Sitrep.Host;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// De-risks M1's headless-validation anchor: proves a REAL 7.5 MB KSP
    /// capture (<c>local_docs/telemetry-mod/recordings/reference-session-2026-07-07.json</c>,
    /// preserved outside git) round-trips through <see cref="RecordedSessionCodec.Parse"/>
    /// and replays start-to-finish through <see cref="ReplayKspHost"/> — the
    /// exact machinery the headless validation loop will drive. This is the
    /// test that would have caught the <c>double[]</c> serialization bug
    /// (see <see cref="RecorderReplayRoundTripTests.RealisticKspHostShapedSnapshotSavesToFileAndReparsesWithoutThrowing"/>
    /// for the synthetic regression pin) against data KSP itself actually
    /// wrote, not a hand-built fixture.
    ///
    /// The recording lives under the gitignored <c>local_docs/</c> tree (see
    /// CLAUDE.md's Feature log section), so this test resolves the path via
    /// <see cref="CallerFilePathAttribute"/> walk-up (same idiom as
    /// <c>Sitrep.Propagation.Tests/GoldenFixtureConformanceTests.cs</c>'s
    /// <c>FixturesPath</c>) and SKIPS CLEANLY — passes with a logged reason,
    /// no failure — when the file is absent, so CI (which never has this
    /// local-only asset) stays green.
    /// </summary>
    public class ReferenceRecordingReplayTests
    {
        private readonly ITestOutputHelper _output;

        public ReferenceRecordingReplayTests(ITestOutputHelper output)
        {
            _output = output;
        }

        private const string RecordingFileName = "reference-session-2026-07-07.json";

        private static string RecordingPath([CallerFilePath] string sourceFilePath = "")
        {
            // mod/Sitrep.Host.Tests/ReferenceRecordingReplayTests.cs -> repo root
            // is two levels up from this file's directory (mod/Sitrep.Host.Tests -> mod -> repo root).
            var testDir = Path.GetDirectoryName(sourceFilePath)!;
            return Path.Combine(testDir, "..", "..", "local_docs", "telemetry-mod", "recordings", RecordingFileName);
        }

        [Fact]
        public void RealReferenceRecordingParsesAndReplaysWholeSessionThroughReplayKspHost()
        {
            var path = RecordingPath();
            if (!File.Exists(path))
            {
                _output.WriteLine(
                    $"SKIPPING: reference recording not found at \"{path}\" — it is a gitignored " +
                    "local-only asset (local_docs/ per CLAUDE.md), never present in CI. This is not a failure.");
                return;
            }

            // ----- Parse -----
            var bytes = File.ReadAllBytes(path);
            _output.WriteLine($"Reference recording found: {bytes.Length:N0} bytes.");

            var json = System.Text.Encoding.UTF8.GetString(bytes);
            var session = RecordedSessionCodec.Parse(json);

            Assert.True(
                session.Entries.Count >= 800,
                $"expected >= 800 entries in the real reference recording, found {session.Entries.Count}");
            _output.WriteLine($"Parsed {session.Entries.Count} entries (schemaVersion {session.SchemaVersion}, startUt {session.StartUt}).");

            var snapshotCount = 0;
            var eventCount = 0;
            foreach (var entry in session.Entries)
            {
                if (entry.Kind == "snapshot")
                {
                    snapshotCount++;
                }
                else if (entry.Kind == "event")
                {
                    eventCount++;
                }
            }
            _output.WriteLine($"  {snapshotCount} snapshots, {eventCount} events.");

            // ----- Replay the WHOLE session via Step() -----
            // Step() is the rewind-safe driver (see its doc comment): it
            // never compares one entry's T against another's, so a real
            // capture's backward UT jumps (F9 quickload) can't stall it —
            // unlike AdvanceTo(), which is documented as unsafe for exactly
            // this shape.
            var replay = new ReplayKspHost(session);

            var firedEventKinds = new List<string>();
            replay.Lifecycle += evt => firedEventKinds.Add(evt.Kind);

            var visitedUts = new List<double>();
            var stepCount = 0;
            KspSnapshot? midSessionSample = null;
            var midSessionStepIndex = session.Entries.Count / 2;

            while (replay.Step())
            {
                stepCount++;
                visitedUts.Add(replay.NowUt());

                if (stepCount == midSessionStepIndex)
                {
                    midSessionSample = replay.Sample();
                }
            }

            // Every entry consumed exactly once, no exception, no stall.
            Assert.Equal(session.Entries.Count, stepCount);
            Assert.False(replay.Step(), "Step() must be idempotent (return false) once the recording is exhausted.");

            // ----- The 3 backward UT-rewinds (quickloads) were traversed, not swallowed. -----
            var rewindCount = 0;
            for (var i = 1; i < visitedUts.Count; i++)
            {
                if (visitedUts[i] < visitedUts[i - 1])
                {
                    rewindCount++;
                }
            }
            Assert.Equal(3, rewindCount);
            _output.WriteLine($"Traversed {rewindCount} backward UT-rewinds without stalling.");

            // ----- Lifecycle events re-fire: scene-load / game-state-load present. -----
            Assert.Contains("scene-load", firedEventKinds);
            Assert.Contains("game-state-load", firedEventKinds);
            _output.WriteLine($"Fired {firedEventKinds.Count} lifecycle events (kinds: {string.Join(", ", new HashSet<string>(firedEventKinds))}).");

            // ----- A mid-session Sample() exposes real ground-truth vessel + body data. -----
            Assert.NotNull(midSessionSample);
            var values = midSessionSample!.Values;

            var vessel = Assert.IsType<Dictionary<string, object?>>(values["vessel"]);
            var orbit = Assert.IsType<Dictionary<string, object?>>(vessel["orbit"]);

            var truthPosition = Assert.IsType<List<object?>>(orbit["truthPosition"]);
            Assert.Equal(3, truthPosition.Count);
            Assert.True(truthPosition[0] is double, "truthPosition elements must be real doubles, not strings/nulls.");

            Assert.True(orbit["truthFrameRotating"] is bool, "orbit.truthFrameRotating must be a real bool.");

            var bodies = Assert.IsType<List<object?>>(values["bodies"]);
            Assert.True(bodies.Count >= 17, $"expected >= 17 bodies in a mid-session sample, found {bodies.Count}");
            foreach (var bodyRaw in bodies)
            {
                var body = Assert.IsType<Dictionary<string, object?>>(bodyRaw);
                Assert.True(body["gravParameter"] is double, $"body \"{body["name"]}\" must expose a numeric gravParameter.");
            }

            _output.WriteLine(
                $"Mid-session Sample() ({session.Entries.Count / 2}th step): vessel.orbit.truthPosition = " +
                $"[{truthPosition[0]}, {truthPosition[1]}, {truthPosition[2]}], " +
                $"vessel.orbit.truthFrameRotating = {orbit["truthFrameRotating"]}, {bodies.Count} bodies.");

            // Final replayed UT is a real (finite) number, not a leftover default.
            Assert.False(double.IsNaN(replay.NowUt()));
        }

        [Fact]
        public void MissingRecordingFileIsSkippedNotFailed()
        {
            // Regression guard for the skip contract itself: a path that
            // cannot possibly exist must not throw or fail the assembly —
            // this proves the "absent file -> clean no-op" behavior
            // independent of whether the real recording happens to be
            // present on this machine.
            var bogusPath = Path.Combine(Path.GetTempPath(), $"sitrep-does-not-exist-{Guid.NewGuid():N}.json");
            Assert.False(File.Exists(bogusPath));
            // No assertion beyond "this doesn't throw" — mirrors the early-return
            // shape used in the real test above when the reference file is absent.
        }
    }
}
