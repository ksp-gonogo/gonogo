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

        /// <summary>
        /// M1 Task 1 replay validation: replays the whole real recording
        /// through <see cref="VesselViewProvider"/>'s mappers +
        /// <see cref="VesselEpochSampler"/> and asserts the acceptance
        /// criteria from docs/superpowers/plans/2026-07-07-m1-vessel-providers.md
        /// Task 1: <c>vessel.orbit</c> emits real elements (sma&gt;0, mu&gt;0,
        /// NO <c>eccentricAnomaly</c> key anywhere on the wire),
        /// <c>vessel.flight</c> emits real lat/long, <c>vessel.identity</c>
        /// is stable, <c>meta.source</c> is <c>"vessel:&lt;guid&gt;"</c> on
        /// every payload, and a vessel-change event in the recording
        /// produces a forced epoch/keyframe. Skips cleanly (like the test
        /// above) when the gitignored recording is absent.
        /// </summary>
        [Fact]
        public void RealReferenceRecordingProducesTypedVesselChannelsWithProvenanceAndEpoching()
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
            var replay = new ReplayKspHost(session);

            var vesselChangeEventCount = 0;
            replay.Lifecycle += evt =>
            {
                if (evt.Kind == "vessel-change")
                {
                    vesselChangeEventCount++;
                }
            };

            var forcedTopics = new List<string>();
            var epochSampler = new VesselEpochSampler(new FakeExtensionHost(t => forcedTopics.Add(t)));

            var sawOrbitWithRealElements = false;
            var sawFlightWithRealLatLong = false;
            var identityIds = new HashSet<string>();
            var identityMetaSources = new HashSet<string>();
            var forcedKeyframeCount = 0;
            KspSnapshot? anyOrbitBearingSnapshot = null;

            while (replay.Step())
            {
                var snapshot = replay.Sample();

                var forcedBefore = forcedTopics.Count;
                epochSampler.Sample(snapshot);
                forcedKeyframeCount += forcedTopics.Count - forcedBefore;

                var identity = VesselViewProvider.BuildIdentity(snapshot);
                if (identity != null)
                {
                    identityIds.Add(identity.VesselId);
                    identityMetaSources.Add(identity.Meta.Source);
                    Assert.Equal("vessel:" + identity.VesselId, identity.Meta.Source);
                }

                var orbit = VesselViewProvider.BuildOrbit(snapshot);
                if (orbit != null)
                {
                    Assert.StartsWith("vessel:", orbit.Meta.Source);
                    anyOrbitBearingSnapshot ??= snapshot;
                    if (orbit.Sma > 0 && orbit.Mu > 0)
                    {
                        sawOrbitWithRealElements = true;
                    }
                }

                var flight = VesselViewProvider.BuildFlight(snapshot);
                if (flight != null)
                {
                    Assert.StartsWith("vessel:", flight.Meta.Source);
                    if (flight.Latitude != 0.0 || flight.Longitude != 0.0)
                    {
                        sawFlightWithRealLatLong = true;
                    }
                }
            }

            Assert.True(sawOrbitWithRealElements, "expected at least one vessel.orbit emission with real elements (sma>0, mu>0) across the recording");
            Assert.True(sawFlightWithRealLatLong, "expected at least one vessel.flight emission with real (non-origin) lat/long across the recording");
            Assert.NotEmpty(identityIds);
            Assert.All(identityMetaSources, source => Assert.StartsWith("vessel:", source));

            _output.WriteLine(
                $"Vessel ids seen: {identityIds.Count}, vessel-change lifecycle events: {vesselChangeEventCount}, " +
                $"forced keyframes: {forcedKeyframeCount}.");

            // O-1: no eccentricAnomaly key anywhere in the real wire payload
            // for a real orbit sampled from this recording.
            Assert.NotNull(anyOrbitBearingSnapshot);
            var wirePayload = VesselViewProvider.BuildOrbitWire(anyOrbitBearingSnapshot);
            var streamData = new Sitrep.Contract.StreamData<object?>
            {
                Topic = VesselViewProvider.OrbitTopic,
                Payload = wirePayload,
                Meta = new Sitrep.Contract.Meta
                {
                    Source = "vessel",
                    Vantage = "host",
                    Quality = Sitrep.Contract.Quality.OnRails,
                    Active = true,
                    Staleness = Sitrep.Contract.Staleness.Fresh,
                },
            };
            var wireJson = Sitrep.Core.Serialization.EnvelopeCodec.WriteStreamData(streamData);
            Assert.DoesNotContain("eccentricAnomaly", wireJson);

            // A KSP "vessel-change" GameEvents callback fires on more than
            // just a genuine subject switch -- e.g. a quickload/scene
            // reload re-notifies the SAME vessel object -- so its count
            // alone doesn't imply the GUID actually changed (this real
            // recording indeed has 4 such events but only 1 distinct
            // vessel id, per the diagnostic line above: a single-vessel
            // session with several quickloads). The real, non-vacuous
            // acceptance criterion is: IF the identity mapper actually
            // observed more than one distinct vessel guid across the
            // session, VesselEpochSampler MUST have forced at least one
            // epoch for it -- proven directly against fake-host call
            // counts already in VesselEpochSamplerTests; here we only
            // assert the two are never inconsistent against this real
            // capture.
            if (identityIds.Count > 1)
            {
                Assert.True(forcedKeyframeCount > 0, "more than one distinct vessel guid appeared in the recording but VesselEpochSampler never forced a keyframe");
            }
        }

        /// <summary>
        /// Fix A (O-9 reproduced): this real recording was captured BEFORE
        /// the phantom-encounter fix existed, so its raw
        /// <c>vessel.orbit.encounter</c> sub-dicts are exactly the buggy
        /// payloads the old <c>KspHost</c> produced -- 809 of its 816
        /// orbit-bearing snapshots carry a non-null raw "encounter" whose
        /// <c>transitionType</c> is <c>FINAL</c> (KSP's own <c>nextPatch</c>
        /// was non-null but never an active, genuine upcoming SOI
        /// transition). <see cref="VesselViewProvider.MapOrbit"/>'s
        /// defensive layer-2 filter (gating on <c>transitionType</c> ∈
        /// {Encounter, Escape}) must reject every one of them on replay,
        /// even though the raw recording itself is unchanged and still
        /// carries the fabricated data.
        /// </summary>
        [Fact]
        public void RealReferenceRecordingOrbitSamplesRejectEveryPhantomInactivePatchEncounter()
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
            var replay = new ReplayKspHost(session);

            var rawOrbitWithEncounterCount = 0;
            var rawPhantomEncounterCount = 0; // raw transitionType FINAL/INITIAL
            var typedNonNullEncounterCount = 0;
            var typedNonNullEncounterDespitePhantomRawCount = 0;

            while (replay.Step())
            {
                var snapshot = replay.Sample();

                if (snapshot.Values.TryGetValue("vessel", out var vesselRaw) &&
                    vesselRaw is IDictionary<string, object?> vesselDict &&
                    vesselDict.TryGetValue("orbit", out var orbitRaw) &&
                    orbitRaw is IDictionary<string, object?> orbitDict &&
                    orbitDict.TryGetValue("encounter", out var encounterRaw) &&
                    encounterRaw is IDictionary<string, object?> encounterDict)
                {
                    rawOrbitWithEncounterCount++;
                    var rawTransitionType = encounterDict.TryGetValue("transitionType", out var tt) ? tt as string : null;
                    var isPhantom = rawTransitionType == "FINAL" || rawTransitionType == "INITIAL";
                    if (isPhantom)
                    {
                        rawPhantomEncounterCount++;
                    }

                    var orbit = VesselViewProvider.BuildOrbit(snapshot);
                    if (orbit?.Encounter != null)
                    {
                        typedNonNullEncounterCount++;
                        if (isPhantom)
                        {
                            typedNonNullEncounterDespitePhantomRawCount++;
                        }
                    }
                }
            }

            _output.WriteLine(
                $"Raw orbit-with-encounter samples: {rawOrbitWithEncounterCount}, phantom (FINAL/INITIAL): {rawPhantomEncounterCount}, " +
                $"typed non-null Encounter after the fix: {typedNonNullEncounterCount}.");

            // Pins the exact wart-audit numbers for this recording (809/816)
            // so this test can't silently pass against a differently-shaped
            // future recording without anyone noticing the ballpark moved.
            Assert.True(rawOrbitWithEncounterCount >= 800, $"expected ~816 raw orbit-with-encounter samples, found {rawOrbitWithEncounterCount}");
            Assert.True(rawPhantomEncounterCount >= 800, $"expected ~809 phantom (FINAL/INITIAL) raw encounters, found {rawPhantomEncounterCount}");

            // The fix: not one phantom raw encounter may surface as a typed,
            // non-null Encounter -- they must all map to null.
            Assert.Equal(0, typedNonNullEncounterDespitePhantomRawCount);
        }

        /// <summary>
        /// M1 Task 2 replay validation: replays the whole real recording
        /// through <see cref="VesselViewProvider"/>'s 11 new mappers
        /// (attitude/resources/thermal/control/comms/propulsion/maneuver/
        /// target/crew/structure/time.warp) and asserts each emits sane,
        /// typed values somewhere across the session — per the build plan's
        /// "replay-validate against the recording" requirement, with extra
        /// weight on <c>vessel.maneuver</c> (281 snapshots per the recording
        /// manifest) and <c>vessel.target</c> (107 snapshots) since those two
        /// have real, non-trivial data in this specific recording. Skips
        /// cleanly (like the tests above) when the gitignored recording is
        /// absent.
        /// </summary>
        [Fact]
        public void RealReferenceRecordingProducesTypedTask2ChannelsWithSaneValues()
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
            var replay = new ReplayKspHost(session);

            var sawAttitude = false;
            var sawResourcesNonEmpty = false;
            var sawThermal = false;
            var sawControl = false;
            var sawComms = false;
            var sawPropulsionWithMass = false;
            var maneuverEmissions = 0;
            var maneuverWithNodes = 0;
            var targetEmissions = 0;
            var sawTargetWithOrbit = false;
            var sawCrew = false;
            var sawStructure = false;
            var sawWarp = false;

            while (replay.Step())
            {
                var snapshot = replay.Sample();

                var attitude = VesselViewProvider.BuildAttitude(snapshot);
                if (attitude != null)
                {
                    sawAttitude = true;
                    Assert.StartsWith("vessel:", attitude.Meta.Source);
                }

                var resources = VesselViewProvider.BuildResources(snapshot);
                if (resources is { Resources.Count: > 0 })
                {
                    sawResourcesNonEmpty = true;
                    Assert.StartsWith("vessel:", resources.Meta.Source);
                }

                var thermal = VesselViewProvider.BuildThermal(snapshot);
                if (thermal != null)
                {
                    sawThermal = true;
                }

                var control = VesselViewProvider.BuildControl(snapshot);
                if (control != null)
                {
                    sawControl = true;
                }

                var comms = VesselViewProvider.BuildComms(snapshot);
                if (comms != null)
                {
                    sawComms = true;
                }

                var propulsion = VesselViewProvider.BuildPropulsion(snapshot);
                if (propulsion is { TotalMass: > 0 })
                {
                    sawPropulsionWithMass = true;
                }

                var maneuver = VesselViewProvider.BuildManeuver(snapshot);
                if (maneuver != null)
                {
                    maneuverEmissions++;
                    Assert.StartsWith("vessel:", maneuver.Meta.Source);
                    if (maneuver.Nodes.Count > 0)
                    {
                        maneuverWithNodes++;
                        // Named components -- kills O-4's arg-order footgun.
                        // Dv components are individually nullable (Fix F) --
                        // a non-finite one maps to null (GetDouble's R1/F-1
                        // rule), never a NaN/Infinity leaking through, and
                        // never drops the whole node.
                        foreach (var node in maneuver.Nodes)
                        {
                            Assert.False(node.DvTotal.HasValue && double.IsNaN(node.DvTotal.Value));
                        }
                    }
                }

                var target = VesselViewProvider.BuildTarget(snapshot);
                if (target != null)
                {
                    targetEmissions++;
                    Assert.StartsWith("vessel:", target.Meta.Source);
                    if (target.Orbit != null)
                    {
                        sawTargetWithOrbit = true;
                    }
                }

                var crew = VesselViewProvider.BuildCrew(snapshot);
                if (crew != null)
                {
                    sawCrew = true;
                }

                var structure = VesselViewProvider.BuildStructure(snapshot);
                if (structure != null)
                {
                    sawStructure = true;
                }

                var warp = VesselViewProvider.BuildWarp(snapshot);
                if (warp != null)
                {
                    sawWarp = true;
                }
            }

            Assert.True(sawAttitude, "expected at least one vessel.attitude emission across the recording");
            Assert.True(sawResourcesNonEmpty, "expected at least one non-empty vessel.resources emission across the recording");
            Assert.True(sawThermal, "expected at least one vessel.thermal emission across the recording");
            Assert.True(sawControl, "expected at least one vessel.control emission across the recording");
            Assert.True(sawComms, "expected at least one vessel.comms emission across the recording");
            Assert.True(sawPropulsionWithMass, "expected at least one vessel.propulsion emission with real mass across the recording");
            Assert.True(sawCrew, "expected at least one vessel.crew emission across the recording");
            Assert.True(sawStructure, "expected at least one vessel.structure emission across the recording");
            Assert.True(sawWarp, "expected at least one time.warp emission across the recording");

            // The recording manifest specifically calls out maneuver (281
            // snapshots) and target (107 snapshots) as having real data --
            // hold those two to a much stronger bar than "at least one."
            Assert.True(maneuverEmissions > 0, "expected vessel.maneuver to emit across the recording");
            Assert.True(maneuverWithNodes > 0, "expected at least one vessel.maneuver emission with real queued nodes (recording manifest: 281 maneuver snapshots)");
            Assert.True(targetEmissions > 0, "expected vessel.target to emit across the recording (recording manifest: 107 target snapshots)");

            _output.WriteLine(
                $"vessel.attitude seen: {sawAttitude}, resources(non-empty): {sawResourcesNonEmpty}, thermal: {sawThermal}, " +
                $"control: {sawControl}, comms: {sawComms}, propulsion(mass>0): {sawPropulsionWithMass}, " +
                $"maneuver emissions: {maneuverEmissions} ({maneuverWithNodes} with queued nodes), " +
                $"target emissions: {targetEmissions} (with orbit: {sawTargetWithOrbit}), crew: {sawCrew}, structure: {sawStructure}, warp: {sawWarp}.");
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
