using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="VesselEpochSampler"/>: the M1 "subject
    /// provenance + epoching" mechanism
    /// (local_docs/telemetry-mod/m1-provider-taxonomy-design.md §6.1) in
    /// isolation, via <see cref="FakeExtensionHost"/> rather than a full
    /// <see cref="ChannelEngine"/> — this is the "detect a vessel-guid
    /// change and force a keyframe on every vessel.* channel" logic on its
    /// own, decoupled from engine plumbing (which
    /// <c>Sitrep.Host.IntegrationTests.ChannelEngineTests.
    /// ForceKeyframeMakesTheNextDecideCallUnconditionalEvenWithinTheDeadband</c>
    /// separately proves end-to-end).
    /// </summary>
    public class VesselEpochSamplerTests
    {
        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";

        [Fact]
        public void FirstObservationOfAVesselDoesNotCountAsASwitch()
        {
            var forced = new List<string>();
            var sampler = new VesselEpochSampler(new FakeExtensionHost(t => forced.Add(t)));

            sampler.Sample(SnapshotFor(VesselA));

            Assert.Empty(forced);
        }

        [Fact]
        public void SwitchingToADifferentVesselForcesAKeyframeOnEveryVesselTopic()
        {
            var forced = new List<string>();
            var sampler = new VesselEpochSampler(new FakeExtensionHost(t => forced.Add(t)));

            sampler.Sample(SnapshotFor(VesselA));
            sampler.Sample(SnapshotFor(VesselA)); // same vessel again -- no force
            sampler.Sample(SnapshotFor(VesselB)); // switch -- force

            Assert.Equal(VesselViewProvider.Topics, forced);
        }

        [Fact]
        public void ReSamplingTheSameVesselNeverForcesAKeyframe()
        {
            var forced = new List<string>();
            var sampler = new VesselEpochSampler(new FakeExtensionHost(t => forced.Add(t)));

            sampler.Sample(SnapshotFor(VesselA));
            for (var i = 0; i < 5; i++)
            {
                sampler.Sample(SnapshotFor(VesselA));
            }

            Assert.Empty(forced);
        }

        [Fact]
        public void ATemporaryGapWithNoActiveVesselDoesNotErasePriorSubjectMemory()
        {
            var forced = new List<string>();
            var sampler = new VesselEpochSampler(new FakeExtensionHost(t => forced.Add(t)));

            sampler.Sample(SnapshotFor(VesselA));
            sampler.Sample(NoVesselSnapshot()); // e.g. a trip through the main menu
            sampler.Sample(SnapshotFor(VesselA)); // re-entering the SAME vessel

            Assert.Empty(forced); // NOT treated as a switch

            sampler.Sample(NoVesselSnapshot());
            sampler.Sample(SnapshotFor(VesselB)); // a DIFFERENT vessel across the same kind of gap

            Assert.Equal(VesselViewProvider.Topics, forced); // IS treated as a switch
        }

        [Fact]
        public void NoActiveVesselNeverForcesAKeyframe()
        {
            var forced = new List<string>();
            var sampler = new VesselEpochSampler(new FakeExtensionHost(t => forced.Add(t)));

            sampler.Sample(NoVesselSnapshot());
            sampler.Sample(NoVesselSnapshot());

            Assert.Empty(forced);
        }

        /// <summary>
        /// M2 subject-scoped-birth fix (the PLAUSIBLE finding closed
        /// alongside the rewind archive-derived-birth defect): a genuine
        /// vessel switch must ALSO reset the engine's per-topic birth guard
        /// for every vessel.* topic -- not just force a keyframe -- so a
        /// channel the NEW vessel has never populated (e.g. no target set)
        /// doesn't inherit the PREVIOUS vessel's "born" state and emit a
        /// spurious tombstone the instant the forced keyframe fires. See
        /// <c>Sitrep.Host.IntegrationTests.ChannelEngineTests.
        /// SwitchingVesselsWithNoDataForATopicOnTheNewVesselEmitsNoSpuriousTombstone</c>
        /// for the full engine/wire-level proof of this same fix.
        /// </summary>
        [Fact]
        public void SwitchingToADifferentVesselAlsoResetsChannelBirthForEveryVesselTopic()
        {
            var forced = new List<string>();
            var birthReset = new List<IReadOnlyCollection<string>>();
            var sampler = new VesselEpochSampler(new FakeExtensionHost(
                t => forced.Add(t),
                topics => birthReset.Add(new List<string>(topics))));

            sampler.Sample(SnapshotFor(VesselA));
            sampler.Sample(SnapshotFor(VesselA)); // same vessel again -- no reset
            Assert.Empty(birthReset);

            sampler.Sample(SnapshotFor(VesselB)); // switch -- reset alongside the force

            Assert.Single(birthReset);
            Assert.Equal(VesselViewProvider.Topics, birthReset[0]);
        }

        /// <summary>
        /// Re-verification Edge 6 — <see cref="VesselEpochSampler"/> was not
        /// rewind-aware: it only ever compared vessel guids, never noticing
        /// that a snapshot's own Ut had gone BACKWARD (a quickload). On a
        /// rewind, whatever vessel happens to be active in the loaded save
        /// can legitimately differ from whatever vessel was active
        /// immediately pre-load — the sampler's plain guid check mis-reads
        /// that as a genuine subject switch and force-keyframes + resets
        /// birth, undoing <c>ChannelEngine</c>'s own archive-derived birth
        /// recompute (which already ran, correctly, earlier in the SAME
        /// tick — see <c>ChannelEngineTests.
        /// RewindThatLandsOnADifferentActiveVesselDoesNotUndoTheArchiveRecomputedBirth</c>
        /// for the full engine/wire-level proof of this same fix). The fix:
        /// track the last snapshot Ut seen; a backward Ut is a cold start —
        /// resynchronize <c>_lastVesselId</c> to the current vessel WITHOUT
        /// forcing a keyframe or resetting birth. A genuine FORWARD switch
        /// (no rewind involved) must still force + reset exactly as before.
        /// </summary>
        [Fact]
        public void ARewindThatLandsOnADifferentVesselIsTreatedAsAColdStartNotASwitch()
        {
            var forced = new List<string>();
            var birthReset = new List<IReadOnlyCollection<string>>();
            var sampler = new VesselEpochSampler(new FakeExtensionHost(
                t => forced.Add(t),
                topics => birthReset.Add(new List<string>(topics))));

            sampler.Sample(SnapshotFor(VesselA, ut: 0.0));
            sampler.Sample(SnapshotFor(VesselA, ut: 1.0)); // same vessel, forward -- no force

            // THE REWIND: Ut goes backward (1.0 -> 0.5), landing on a
            // DIFFERENT vessel (B) than was active pre-rewind (A). Must be
            // treated as a cold start: no force, no birth reset.
            sampler.Sample(SnapshotFor(VesselB, ut: 0.5));

            Assert.Empty(forced);
            Assert.Empty(birthReset);

            // A genuine FORWARD switch after the rewind's cold start (Ut
            // 0.5 -> 0.6, still ahead of the rewind's own Ut) must still
            // force + reset exactly as before -- the rewind fix must not
            // suppress real switches, only rewind-induced false positives.
            sampler.Sample(SnapshotFor(VesselA, ut: 0.6));

            Assert.Equal(VesselViewProvider.Topics, forced);
            Assert.Single(birthReset);
            Assert.Equal(VesselViewProvider.Topics, birthReset[0]);
        }

        private static KspSnapshot SnapshotFor(string vesselId) => SnapshotFor(vesselId, ut: 0.0);

        private static KspSnapshot SnapshotFor(string vesselId, double ut) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = vesselId },
                },
            },
        };

        private static KspSnapshot NoVesselSnapshot() => new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };
    }
}
