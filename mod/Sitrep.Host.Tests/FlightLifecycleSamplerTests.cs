using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Flight;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="FlightLifecycleSampler"/> in isolation —
    /// mirrors <c>VesselEpochSamplerTests</c>'s style (a fake
    /// <see cref="IChannelPublisher"/> per channel, hand-built
    /// <see cref="KspSnapshot"/>s) rather than a full <see cref="Sitrep.Host.ChannelEngine"/>,
    /// which <c>Sitrep.Host.IntegrationTests.FlightEndToEndTests</c> covers
    /// separately for the wire-level/revert-erasure proof.
    /// </summary>
    public class FlightLifecycleSamplerTests
    {
        private const string VesselA = "aaaaaaaa-0000-0000-0000-000000000000";
        private const string VesselB = "bbbbbbbb-0000-0000-0000-000000000000";

        private sealed class FakePublisher : IChannelPublisher
        {
            public readonly List<(object? Payload, double Ut)> Calls = new();
            public void Publish(object? payload, double ut) => Calls.Add((payload, ut));
        }

        private sealed class Rig
        {
            public readonly FakePublisher Current = new();
            public readonly FakePublisher Started = new();
            public readonly FakePublisher Ended = new();
            public readonly FakePublisher VesselChanged = new();
            public readonly FlightLifecycleSampler Sampler;

            public Rig()
            {
                Sampler = new FlightLifecycleSampler(Current, Started, Ended, VesselChanged);
            }
        }

        private static KspSnapshot SnapshotFor(string vesselId, double ut, string name = "Alpha", string situation = "FLYING") => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?>
                    {
                        ["id"] = vesselId,
                        ["name"] = name,
                        ["situation"] = situation,
                    },
                },
            },
        };

        private static KspSnapshot NoVesselSnapshot(double ut) => new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() };

        [Fact]
        public void FirstObservationOfAVesselPublishesStartedAndCurrent()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));

            var started = Assert.Single(rig.Started.Calls);
            var payload = Assert.IsType<FlightStarted>(started.Payload);
            Assert.Equal(VesselA, payload.FlightId);
            Assert.Equal(VesselA, payload.VesselId);
            Assert.Equal("Alpha", payload.VesselName);
            Assert.Equal(0.0, started.Ut);

            var current = Assert.Single(rig.Current.Calls);
            var currentPayload = Assert.IsType<FlightCurrent>(current.Payload);
            Assert.Equal(VesselA, currentPayload.FlightId);
            Assert.Equal(Situation.Flying, currentPayload.Phase);

            Assert.Empty(rig.Ended.Calls);
            Assert.Empty(rig.VesselChanged.Calls);
        }

        [Fact]
        public void ReSamplingTheSameVesselNeverRePublishesStarted()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0));
            rig.Sampler.Sample(SnapshotFor(VesselA, 1.0));
            rig.Sampler.Sample(SnapshotFor(VesselA, 2.0, situation: "ORBITING"));

            Assert.Single(rig.Started.Calls);
            Assert.Equal(3, rig.Current.Calls.Count);
            Assert.Equal(Situation.Orbiting, Assert.IsType<FlightCurrent>(rig.Current.Calls[2].Payload).Phase);
        }

        [Fact]
        public void SwitchingToANeverSeenVesselPublishesStartedAndVesselChanged()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 1.0, name: "Bravo"));

            Assert.Equal(2, rig.Started.Calls.Count);
            Assert.Equal(VesselB, Assert.IsType<FlightStarted>(rig.Started.Calls[1].Payload).VesselId);

            var changed = Assert.Single(rig.VesselChanged.Calls);
            var payload = Assert.IsType<FlightVesselChanged>(changed.Payload);
            Assert.Equal(VesselB, payload.VesselId);
            Assert.Equal(VesselA, payload.PreviousVesselId);
        }

        [Fact]
        public void SwitchingBackToAnAlreadyStartedVesselOnlyPublishesVesselChanged()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 1.0, name: "Bravo"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 2.0, name: "Alpha")); // switch BACK to a known vessel

            // Started only for A (cold start) and B (never seen) -- NOT a
            // third time for A on the switch-back.
            Assert.Equal(2, rig.Started.Calls.Count);
            Assert.Equal(2, rig.VesselChanged.Calls.Count);
            Assert.Equal(VesselA, Assert.IsType<FlightVesselChanged>(rig.VesselChanged.Calls[1].Payload).VesselId);
        }

        [Fact]
        public void CrashSignalDrainedOnNextSamplePublishesEndedCrashed()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));

            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 5.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 6.0)); // drains the queued signal

            var ended = Assert.Single(rig.Ended.Calls);
            var payload = Assert.IsType<FlightEnded>(ended.Payload);
            Assert.Equal(VesselA, payload.VesselId);
            Assert.Equal(FlightEndReason.Crashed, payload.Reason);
            Assert.Equal(5.0, payload.Ut);
            Assert.Equal(5.0, ended.Ut);
        }

        [Fact]
        public void RecoverySignalDrainedOnNextSamplePublishesEndedRecovered()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));

            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Recovered, 5.0);
            rig.Sampler.Sample(NoVesselSnapshot(6.0)); // vessel gone post-recovery

            var ended = Assert.Single(rig.Ended.Calls);
            Assert.Equal(FlightEndReason.Recovered, Assert.IsType<FlightEnded>(ended.Payload).Reason);
        }

        [Fact]
        public void SignalEndForANeverStartedVesselIsANoOp()
        {
            var rig = new Rig();
            // No prior Sample() ever observed VesselA -- e.g. a filtered
            // debris death that still (hypothetically) reached SignalEnd.
            rig.Sampler.SignalEnd(VesselA, "Debris", FlightEndReason.Crashed, 5.0);
            rig.Sampler.Sample(NoVesselSnapshot(6.0));

            Assert.Empty(rig.Ended.Calls);
        }

        [Fact]
        public void RevertWithAnOpenFlightPublishesEndedRevertedThenStartedForTheNewVessel()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 10.0, name: "Alpha"));

            // THE REVERT: Ut jumps backward, landing on a (possibly
            // different, possibly re-spawned) vessel.
            rig.Sampler.Sample(SnapshotFor(VesselB, 0.5, name: "Bravo"));

            var ended = Assert.Single(rig.Ended.Calls);
            var endedPayload = Assert.IsType<FlightEnded>(ended.Payload);
            Assert.Equal(VesselA, endedPayload.VesselId);
            Assert.Equal(FlightEndReason.Reverted, endedPayload.Reason);
            // Ended at the REVERT-TARGET ut (0.5) -- not the pre-revert
            // highwater mark (10.0) and not some wall-clock capture — this is
            // what keeps the event on the surviving side of the timeline
            // reset (see the sampler's own doc comment).
            Assert.Equal(0.5, endedPayload.Ut);

            // A fresh flight.started for whatever vessel the new timeline
            // shows, at the same revert-target ut.
            Assert.Equal(2, rig.Started.Calls.Count);
            var restarted = Assert.IsType<FlightStarted>(rig.Started.Calls[1].Payload);
            Assert.Equal(VesselB, restarted.VesselId);
            Assert.Equal(0.5, restarted.Ut);
        }

        [Fact]
        public void RevertWithNoOpenFlightPublishesNoEndedEvent()
        {
            var rig = new Rig();
            rig.Sampler.Sample(NoVesselSnapshot(10.0));

            // Rewind with nothing active to end.
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.5, name: "Alpha"));

            Assert.Empty(rig.Ended.Calls);
            Assert.Single(rig.Started.Calls);
        }

        [Fact]
        public void RevertToNoVesselEndsTheOpenFlightAndStartsNothing()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 10.0, name: "Alpha"));

            rig.Sampler.Sample(NoVesselSnapshot(0.5)); // rewind, no vessel this tick

            var ended = Assert.Single(rig.Ended.Calls);
            Assert.Equal(FlightEndReason.Reverted, Assert.IsType<FlightEnded>(ended.Payload).Reason);
            Assert.Single(rig.Started.Calls); // only the original start, no new one
        }

        [Fact]
        public void ARewindThatLandsOnTheSameVesselIdIsTreatedAsAFreshStartAnyway()
        {
            // A quickload can legitimately resume the SAME Vessel.id (loading
            // a save that still has it). The sampler deliberately treats
            // every rewind as a hard timeline reset for lifecycle purposes
            // (see the class doc comment) -- re-announcing "started" even
            // for a same-id resume, rather than trying to distinguish
            // "resumed" from "genuinely new" here.
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 10.0, name: "Alpha"));

            rig.Sampler.Sample(SnapshotFor(VesselA, 0.5, name: "Alpha")); // rewind, same id

            Assert.Single(rig.Ended.Calls);
            Assert.Equal(2, rig.Started.Calls.Count);
        }

        [Fact]
        public void RevertBeforeAnAlreadyAppliedEndRetroactivelyRepublishesItAsReverted()
        {
            // The scenario RevertErasesAnUnrevealedCrashButItsOwnRevertedAndStartedEventsSurvive
            // proves end-to-end over a real ChannelEngine: a crash SIGNAL
            // (main-thread GameEvent) can be DRAINED and APPLIED (ApplyEnd)
            // by this sampler well before the wire's reveal gate has let it
            // reach the operator -- this sampler has no visibility into that
            // reveal-buffer state. So a revert targeting a Ut at/before the
            // applied end's Ut must retroactively re-announce it as
            // Reverted, or the operator (who may never have seen the
            // original end reveal) is left with a flight that silently
            // never closes.
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));

            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 5.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 5.1)); // drains + applies the crash NOW

            // THE REVERT: targets Ut 2 -- BEFORE the crash's Ut 5, so the
            // crash (whether or not it ever reached the wire) happened on
            // the abandoned branch.
            rig.Sampler.Sample(SnapshotFor(VesselB, 2.0, name: "Bravo"));

            Assert.Equal(2, rig.Ended.Calls.Count);
            var firstEnd = Assert.IsType<FlightEnded>(rig.Ended.Calls[0].Payload);
            Assert.Equal(FlightEndReason.Crashed, firstEnd.Reason);
            var secondEnd = Assert.IsType<FlightEnded>(rig.Ended.Calls[1].Payload);
            Assert.Equal(VesselA, secondEnd.VesselId);
            Assert.Equal(FlightEndReason.Reverted, secondEnd.Reason);
            Assert.Equal(2.0, secondEnd.Ut); // stamped at the revert-target Ut, not the original crash Ut
        }

        [Fact]
        public void RevertAfterAnAlreadyAppliedEndLeavesItAlone()
        {
            // The mirror case: the revert TARGET Ut is AFTER the applied
            // end's Ut -- that end safely predates the reverted-to point and
            // must NOT be retroactively touched.
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 5.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 5.1)); // applies the crash
            rig.Sampler.Sample(SnapshotFor(VesselB, 10.0, name: "Bravo")); // unrelated later launch

            // A rewind targeting Ut 7 -- AFTER the Ut-5 crash, so it safely predates this revert target.
            rig.Sampler.Sample(SnapshotFor(VesselB, 7.0, name: "Bravo"));

            // Only VesselB's own revert-ended event fires; the long-past
            // crash is untouched (still exactly the one Crashed publish).
            Assert.Equal(2, rig.Ended.Calls.Count);
            Assert.Equal(FlightEndReason.Crashed, Assert.IsType<FlightEnded>(rig.Ended.Calls[0].Payload).Reason);
            Assert.Equal(FlightEndReason.Reverted, Assert.IsType<FlightEnded>(rig.Ended.Calls[1].Payload).Reason);
            Assert.Equal(VesselB, Assert.IsType<FlightEnded>(rig.Ended.Calls[1].Payload).VesselId);
        }

        [Fact]
        public void NoActiveVesselNeverPublishesCurrent()
        {
            var rig = new Rig();
            rig.Sampler.Sample(NoVesselSnapshot(0.0));
            rig.Sampler.Sample(NoVesselSnapshot(1.0));

            Assert.Empty(rig.Current.Calls);
            Assert.Empty(rig.Started.Calls);
        }
    }
}
