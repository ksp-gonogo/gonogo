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

        private static KspSnapshot SnapshotFor(string vesselId) => new KspSnapshot
        {
            Ut = 0.0,
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
