using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Flight;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="FlightLifecycleSampler"/> in isolation,
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

        private sealed class FakePublisher : ICraftSaidPublisher
        {
            public readonly List<(object? Payload, double Ut)> Calls = new();

            /// <summary>For each call, the craft it was said by, or null for one published as the flown craft.</summary>
            public readonly List<string?> SaidBy = new();

            public void Publish(object? payload, double ut)
            {
                Calls.Add((payload, ut));
                SaidBy.Add(null);
            }

            public void PublishSaidBy(string vesselId, object? payload, double ut)
            {
                Calls.Add((payload, ut));
                SaidBy.Add(vesselId);
            }
        }

        private sealed class Rig
        {
            public readonly FakePublisher Current = new();
            public readonly FakePublisher Started = new();
            public readonly FakePublisher Ended = new();
            public readonly FakePublisher VesselChanged = new();
            public readonly FlightLifecycleSampler Sampler;

            /// <summary>
            /// Stands in for <c>host.IsAnyTopicSubscribed("flight.started")</c>.
            /// Defaults to a subscribed client, which is what every test
            /// written before the re-announce assumed.
            /// </summary>
            public bool StartedHasAudience = true;

            public readonly List<string> Reports = new();

            private int _minted;

            public Rig()
            {
                Sampler = new FlightLifecycleSampler(Current, Started, Ended, VesselChanged, () => StartedHasAudience, Reports.Add, () => "flight-" + (++_minted));
            }
        }

        private static KspSnapshot SnapshotFor(string vesselId, double ut, string name = "Alpha", string situation = "FLYING", string? evaKerbal = null, string? rootPartId = null) => new KspSnapshot
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
                        ["evaKerbal"] = evaKerbal,
                        ["rootPartId"] = rootPartId,
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
            Assert.Equal("flight-1", payload.FlightId);
            Assert.Equal(VesselA, payload.VesselId);
            Assert.Equal("Alpha", payload.VesselName);
            Assert.Equal(0.0, started.Ut);

            var current = Assert.Single(rig.Current.Calls);
            var currentPayload = Assert.IsType<FlightCurrent>(current.Payload);
            Assert.Equal("flight-1", currentPayload.FlightId);
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
            Assert.Equal(VesselA, Assert.Single(rig.Ended.SaidBy));
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
            Assert.Null(Assert.Single(rig.Ended.SaidBy));
        }

        [Fact]
        public void SignalEndForANeverStartedVesselPublishesNothingAndIsCountedAndReported()
        {
            var rig = new Rig();
            rig.Sampler.SignalEnd(VesselA, "Debris", FlightEndReason.Crashed, 5.0);
            rig.Sampler.Sample(NoVesselSnapshot(6.0));

            Assert.Empty(rig.Ended.Calls);
            Assert.Equal(1, rig.Sampler.EndsWithoutStart);
            var report = Assert.Single(rig.Reports);
            Assert.Contains(VesselA, report);
            Assert.Contains("Crashed", report);
        }

        [Fact]
        public void ACrashSignalledBeforeTheSampleThatFirstShowsTheVesselStillPublishesStartedThenEnded()
        {
            var rig = new Rig();
            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 6.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 6.0));

            var started = Assert.Single(rig.Started.Calls);
            Assert.Equal(VesselA, ((FlightStarted)started.Payload!).VesselId);
            var ended = Assert.Single(rig.Ended.Calls);
            Assert.Equal(FlightEndReason.Crashed, ((FlightEnded)ended.Payload!).Reason);
            Assert.Equal(0, rig.Sampler.EndsWithoutStart);
            Assert.Empty(rig.Reports);
        }

        [Fact]
        public void ACrashOnTheFirstSampleAfterARevertPublishesStartedThenEndedAndStaysEnded()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 100.0));
            rig.Sampler.SignalEnd(VesselB, "Beta", FlightEndReason.Crashed, 40.0);
            rig.Sampler.Sample(SnapshotFor(VesselB, 40.0, "Beta"));

            Assert.Contains(rig.Ended.Calls, c => ((FlightEnded)c.Payload!).VesselId == VesselB
                && ((FlightEnded)c.Payload!).Reason == FlightEndReason.Crashed);
            Assert.DoesNotContain(rig.Ended.Calls, c => ((FlightEnded)c.Payload!).VesselId == VesselB
                && ((FlightEnded)c.Payload!).Reason == FlightEndReason.Reverted);
            Assert.Equal(1, rig.Started.Calls.Count(c => ((FlightStarted)c.Payload!).VesselId == VesselB));
            AssertEndedOnce(rig, VesselA, FlightEndReason.Reverted);
        }

        [Fact]
        public void ANeverSeenVesselCrashingOnItsFirstTickWithoutARewindStillEndsTheOpenFlightReverted()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 100.0));
            rig.Sampler.SignalEnd(VesselB, "Beta", FlightEndReason.Crashed, 101.0);
            rig.Sampler.Sample(SnapshotFor(VesselB, 101.0, "Beta"));

            AssertEndedOnce(rig, VesselA, FlightEndReason.Reverted);
            AssertEndedOnce(rig, VesselB, FlightEndReason.Crashed);
        }

        private static void AssertEndedOnce(Rig rig, string vesselId, FlightEndReason reason)
        {
            var ends = rig.Ended.Calls.Select(c => (FlightEnded)c.Payload!).Where(e => e.VesselId == vesselId).ToList();
            Assert.Single(ends);
            Assert.Equal(reason, ends[0].Reason);
        }

        [Fact]
        public void AnEndForAVesselTheSamplerSawStartIsNeitherCountedNorReported()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 1.0));
            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Recovered, 5.0);
            rig.Sampler.Sample(NoVesselSnapshot(6.0));

            Assert.Single(rig.Ended.Calls);
            Assert.Equal(0, rig.Sampler.EndsWithoutStart);
            Assert.Empty(rig.Reports);
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
            rig.Sampler.Sample(SnapshotFor(VesselB, 0.6, name: "Bravo"));

            var ended = Assert.Single(rig.Ended.Calls);
            var endedPayload = Assert.IsType<FlightEnded>(ended.Payload);
            Assert.Equal(VesselA, endedPayload.VesselId);
            Assert.Equal(FlightEndReason.Reverted, endedPayload.Reason);
            // Ended at the REVERT-TARGET ut (0.5) -- not the pre-revert
            // highwater mark (10.0) and not some wall-clock capture, this is
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
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.6, name: "Alpha"));

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
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.6, name: "Alpha"));

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
        public void AFlightStartedWithNobodyListeningIsAnnouncedWhenSomeoneSubscribes()
        {
            // The ordinary case, not an edge one: KSP is already running when
            // the browser connects, so the launch publish is dropped by an
            // engine that has no subscriber to hand it to.
            var rig = new Rig { StartedHasAudience = false };
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 1.0, name: "Alpha"));

            Assert.Empty(rig.Started.Calls);

            rig.StartedHasAudience = true;
            rig.Sampler.Sample(SnapshotFor(VesselA, 2.0, name: "Alpha"));

            var started = Assert.Single(rig.Started.Calls);
            var payload = Assert.IsType<FlightStarted>(started.Payload);
            Assert.Equal("flight-1", payload.FlightId);
            Assert.Equal("Alpha", payload.VesselName);
        }

        [Fact]
        public void TheAnnouncementCarriesTheOriginalStartInstantNotTheMomentItWasMade()
        {
            // A flight did not start when an operator opened the dashboard,
            // and this is also what lets a client tell this apart from a
            // revert's genuinely new start for the same vessel id.
            var rig = new Rig { StartedHasAudience = false };
            rig.Sampler.Sample(SnapshotFor(VesselA, 7.0, name: "Alpha"));

            rig.StartedHasAudience = true;
            rig.Sampler.Sample(SnapshotFor(VesselA, 900.0, name: "Alpha"));

            var started = Assert.Single(rig.Started.Calls);
            Assert.Equal(7.0, Assert.IsType<FlightStarted>(started.Payload).Ut);
            Assert.Equal(7.0, started.Ut);
        }

        [Fact]
        public void AnAudienceAlreadyToldIsNotToldAgainEveryTick()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 1.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 2.0, name: "Alpha"));

            Assert.Single(rig.Started.Calls);
        }

        [Fact]
        public void AnAudienceThatLeavesAndComesBackIsToldAgain()
        {
            // Whoever subscribes next is a client that has heard nothing, and
            // from here the two are indistinguishable.
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            Assert.Single(rig.Started.Calls);

            rig.StartedHasAudience = false;
            rig.Sampler.Sample(SnapshotFor(VesselA, 1.0, name: "Alpha"));
            Assert.Single(rig.Started.Calls);

            rig.StartedHasAudience = true;
            rig.Sampler.Sample(SnapshotFor(VesselA, 2.0, name: "Alpha"));

            Assert.Equal(2, rig.Started.Calls.Count);
            Assert.Equal(0.0, Assert.IsType<FlightStarted>(rig.Started.Calls[1].Payload).Ut);
        }

        [Fact]
        public void AFlightThatHasEndedIsNeverAnnouncedToALaterAudience()
        {
            var rig = new Rig { StartedHasAudience = false };
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Recovered, 5.0);
            rig.Sampler.Sample(NoVesselSnapshot(6.0));

            rig.StartedHasAudience = true;
            rig.Sampler.Sample(NoVesselSnapshot(7.0));

            Assert.Empty(rig.Started.Calls);
        }

        [Fact]
        public void SwitchingBackToAKnownVesselTellsAWatchingClientNothingNew()
        {
            // vesselChanged is what carries that transition; a started here
            // would claim Alpha launched twice.
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 1.0, name: "Bravo"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 2.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 3.0, name: "Alpha"));

            Assert.Equal(2, rig.Started.Calls.Count); // Alpha's launch and Bravo's, nothing more
        }

        [Fact]
        public void ALateSubscriberIsToldAboutTheVesselInFocusNowNotTheOneThatLaunchedFirst()
        {
            var rig = new Rig { StartedHasAudience = false };
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 10.0, name: "Bravo"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 20.0, name: "Alpha")); // focus back onto Alpha

            rig.StartedHasAudience = true;
            rig.Sampler.Sample(SnapshotFor(VesselA, 21.0, name: "Alpha"));

            var started = Assert.Single(rig.Started.Calls);
            var payload = Assert.IsType<FlightStarted>(started.Payload);
            Assert.Equal(VesselA, payload.VesselId);
            Assert.Equal(0.0, payload.Ut); // Alpha's own launch, not the moment focus came back
        }

        [Fact]
        public void ARevertIsAnnouncedEvenToAClientThatAlreadyHeldThatFlightId()
        {
            // The revert's start carries the revert-target UT, which is how a
            // client tells it from a re-announce of the flight it holds.
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 10.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.5, name: "Alpha")); // rewind, same id
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.6, name: "Alpha"));

            Assert.Equal(2, rig.Started.Calls.Count);
            Assert.Equal(0.0, Assert.IsType<FlightStarted>(rig.Started.Calls[0].Payload).Ut);
            Assert.Equal(0.5, Assert.IsType<FlightStarted>(rig.Started.Calls[1].Payload).Ut);
        }

        [Fact]
        public void ARevertToTheSameVesselStartsAFlightWithAnIdOfItsOwn()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 10.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.5, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.6, name: "Alpha"));

            var first = (FlightStarted)rig.Started.Calls[0].Payload!;
            var second = (FlightStarted)rig.Started.Calls[1].Payload!;
            Assert.Equal(VesselA, first.VesselId);
            Assert.Equal(VesselA, second.VesselId);
            Assert.NotEqual(first.FlightId, second.FlightId);

            var ended = Assert.IsType<FlightEnded>(Assert.Single(rig.Ended.Calls).Payload);
            Assert.Equal(first.FlightId, ended.FlightId);
            Assert.Equal(second.FlightId, ((FlightCurrent)rig.Current.Calls[^1].Payload!).FlightId);
        }

        [Fact]
        public void ARevertWhoseFirstTickShowsNoVesselStillStartsANewFlightOnTheNextVessel()
        {
            // The scene reloads on a revert, so the first tick after the rewind can have no active vessel.
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 10.0, name: "Alpha"));
            rig.Sampler.Sample(NoVesselSnapshot(0.5));
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.6, name: "Alpha"));

            Assert.Equal(2, rig.Started.Calls.Count);
            var second = (FlightStarted)rig.Started.Calls[1].Payload!;
            Assert.Equal(VesselA, second.VesselId);
            Assert.NotEqual(((FlightStarted)rig.Started.Calls[0].Payload!).FlightId, second.FlightId);
            Assert.Equal(second.FlightId, ((FlightCurrent)rig.Current.Calls[^1].Payload!).FlightId);
            AssertEndedOnce(rig, VesselA, FlightEndReason.Reverted);
        }

        [Fact]
        public void ACrashThenARevertKeepsTheCrashAndStartsANewFlightForTheSameVessel()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 20.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 20.1, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.5, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.6, name: "Alpha"));

            var crashedFlight = ((FlightStarted)rig.Started.Calls[0].Payload!).FlightId;
            var newFlight = ((FlightStarted)rig.Started.Calls[1].Payload!).FlightId;
            Assert.NotEqual(crashedFlight, newFlight);

            var ends = rig.Ended.Calls.Select(c => (FlightEnded)c.Payload!).ToList();
            Assert.Equal(FlightEndReason.Crashed, ends[0].Reason);
            Assert.Equal(crashedFlight, ends[0].FlightId);
            Assert.DoesNotContain(ends, e => e.FlightId == newFlight);
            Assert.All(ends.Skip(1), e => Assert.Equal(crashedFlight, e.FlightId));
        }

        [Fact]
        public void ACrashOnTheAbandonedBranchDrainedWithTheRevertTickStillLeavesTheNewFlightStarted()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 19.0, name: "Alpha"));
            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 20.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.5, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.6, name: "Alpha"));

            Assert.Equal(2, rig.Started.Calls.Count);
            var newFlight = ((FlightStarted)rig.Started.Calls[1].Payload!).FlightId;
            Assert.Equal(newFlight, ((FlightCurrent)rig.Current.Calls[^1].Payload!).FlightId);
            Assert.DoesNotContain(rig.Ended.Calls, c => ((FlightEnded)c.Payload!).FlightId == newFlight);
        }

        [Fact]
        public void ADockEndsTheAbsorbedCraftsFlightAsDockedNamingTheCraftItJoined()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 5.0, name: "Bravo"));
            rig.Sampler.SignalDocked(VesselB, "Bravo", VesselA, "Alpha", 9.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 9.1, name: "Alpha"));

            var bravoFlight = ((FlightStarted)rig.Started.Calls[1].Payload!).FlightId;
            var ended = Assert.IsType<FlightEnded>(Assert.Single(rig.Ended.Calls).Payload);
            Assert.Equal(bravoFlight, ended.FlightId);
            Assert.Equal(FlightEndReason.Docked, ended.Reason);
            Assert.Equal(VesselA, ended.JoinedVesselId);
            Assert.Equal("Alpha", ended.JoinedVesselName);
            Assert.Equal(0, rig.Sampler.EndsWithoutStart);

            // Focus moved onto the craft that was kept, whose own flight carries on.
            var changed = Assert.IsType<FlightVesselChanged>(rig.VesselChanged.Calls[^1].Payload);
            Assert.Equal(VesselA, changed.VesselId);
        }

        [Fact]
        public void ADockWithACraftNobodyFlewPublishesNothingAndIsNotCountedAsAGap()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.SignalDocked(VesselB, "Bravo", VesselA, "Alpha", 3.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 3.1, name: "Alpha"));

            Assert.Empty(rig.Ended.Calls);
            Assert.Equal(0, rig.Sampler.EndsWithoutStart);
            Assert.Empty(rig.Reports);
        }

        [Fact]
        public void ARevertToBeforeADockEndsTheDockedFlightAgainAsRevertedWithoutAJoinedCraft()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 5.0, name: "Bravo"));
            rig.Sampler.SignalDocked(VesselB, "Bravo", VesselA, "Alpha", 9.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 9.1, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 4.0, name: "Bravo"));

            var reverted = rig.Ended.Calls.Select(c => (FlightEnded)c.Payload!)
                .Where(e => e.Reason == FlightEndReason.Reverted && e.VesselId == VesselB).ToList();
            var again = Assert.Single(reverted);
            Assert.Null(again.JoinedVesselId);
            Assert.Null(again.JoinedVesselName);
        }

        [Fact]
        public void ARevertEndsEveryFlightStillOpenNotOnlyTheOneInFocus()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 5.0, name: "Bravo"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.5, name: "Alpha"));

            AssertEndedOnce(rig, VesselA, FlightEndReason.Reverted);
            AssertEndedOnce(rig, VesselB, FlightEndReason.Reverted);

            // Focus moving onto the vessel left behind is a flight of its own after the rewind.
            rig.Sampler.Sample(SnapshotFor(VesselB, 1.0, name: "Bravo"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 1.1, name: "Bravo"));
            Assert.Equal(1, rig.Started.Calls.Count(c => ((FlightStarted)c.Payload!).VesselId == VesselB && ((FlightStarted)c.Payload!).Ut == 1.0));
        }

        [Fact]
        public void ASecondLossSignalledForAFlightThatAlreadyEndedPublishesNothing()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 5.0);
            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Destroyed, 5.0);
            rig.Sampler.Sample(NoVesselSnapshot(6.0));

            AssertEndedOnce(rig, VesselA, FlightEndReason.Crashed);
        }

        private const string VesselC = "cccccccc-0000-0000-0000-000000000000";

        private static (Rig Rig, string BravoFlight) DockedBravoIntoAlpha()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha", rootPartId: "root-a"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 5.0, name: "Bravo", rootPartId: "root-b"));
            var bravoFlight = ((FlightStarted)rig.Started.Calls[1].Payload!).FlightId;
            rig.Sampler.SignalDocked(VesselB, "Bravo", VesselA, "Alpha", 9.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 9.1, name: "Alpha", rootPartId: "root-a"));
            return (rig, bravoFlight);
        }

        [Fact]
        public void TheCraftThatComesOffAnUndockFliesTheFlightThatDockedAgain()
        {
            var (rig, bravoFlight) = DockedBravoIntoAlpha();
            var bravoStart = ((FlightStarted)rig.Started.Calls[1].Payload!).Ut;

            rig.Sampler.Sample(SnapshotFor(VesselC, 12.0, name: "Bravo", rootPartId: "root-b"));

            var resumed = (FlightStarted)rig.Started.Calls[^1].Payload!;
            Assert.Equal(bravoFlight, resumed.FlightId);
            Assert.Equal(VesselC, resumed.VesselId);
            Assert.Equal(bravoStart, resumed.Ut);
            Assert.True(resumed.ResumesAfterDock);
            var changed = (FlightVesselChanged)rig.VesselChanged.Calls[^1].Payload!;
            Assert.Equal(bravoFlight, changed.FlightId);
            Assert.Equal(VesselC, changed.VesselId);
            Assert.Equal(bravoFlight, ((FlightCurrent)rig.Current.Calls[^1].Payload!).FlightId);
        }

        [Fact]
        public void ACraftGrabbedByTheClawAndReleasedFliesItsFlightAgainLikeAnUndockedOne()
        {
            // A claw grab is the same absorption as a dock (Part.Couple, no onVesselDocking), and
            // the release the same split (Part.Undock with the saved root), so both reach the
            // sampler as a Docked end and a vessel with a new id and the old root part.
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha", rootPartId: "root-a"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 5.0, name: "Spare X", rootPartId: "root-x"));
            var spareFlight = ((FlightStarted)rig.Started.Calls[1].Payload!).FlightId;
            rig.Sampler.SignalDocked(VesselB, "Spare X", VesselA, "Alpha", 9.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 9.1, name: "Alpha", rootPartId: "root-a"));

            // Release: the craft comes back with a vessel id of its own, and its focus is taken.
            rig.Sampler.Sample(SnapshotFor(VesselC, 30.0, name: "Spare X", rootPartId: "root-x"));

            var ended = rig.Ended.Calls.Select(c => (FlightEnded)c.Payload!).Single();
            Assert.Equal(FlightEndReason.Docked, ended.Reason);
            Assert.Equal(spareFlight, ended.FlightId);
            var resumed = (FlightStarted)rig.Started.Calls[^1].Payload!;
            Assert.Equal(spareFlight, resumed.FlightId);
            Assert.Equal(VesselC, resumed.VesselId);
            Assert.True(resumed.ResumesAfterDock);
        }

        [Fact]
        public void ACraftReleasedByAnUndockStartsItsFlightAtOnceWithoutBeingFlown()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha", rootPartId: "root-a"));

            rig.Sampler.SignalReleased(VesselC, "Charlie", "root-c", 4.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 4.1, name: "Alpha", rootPartId: "root-a"));

            var released = (FlightStarted)rig.Started.Calls[^1].Payload!;
            Assert.Equal(VesselC, released.VesselId);
            Assert.Equal(4.0, released.Ut);
            Assert.False(released.ResumesAfterDock);
            Assert.Empty(rig.VesselChanged.Calls);
            Assert.Equal(VesselA, ((FlightCurrent)rig.Current.Calls[^1].Payload!).VesselId);

            // Switching to it later only moves focus: its flight was already announced.
            rig.Sampler.Sample(SnapshotFor(VesselC, 9.0, name: "Charlie", rootPartId: "root-c"));

            Assert.Equal(2, rig.Started.Calls.Count);
            var changed = (FlightVesselChanged)Assert.Single(rig.VesselChanged.Calls).Payload!;
            Assert.Equal(released.FlightId, changed.FlightId);
        }

        [Fact]
        public void ACraftReleasedByAnUndockResumesTheFlightThatDockedWithoutBeingFlown()
        {
            var (rig, bravoFlight) = DockedBravoIntoAlpha();

            rig.Sampler.SignalReleased(VesselC, "Bravo", "root-b", 12.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 12.1, name: "Alpha", rootPartId: "root-a"));

            var resumed = (FlightStarted)rig.Started.Calls[^1].Payload!;
            Assert.Equal(bravoFlight, resumed.FlightId);
            Assert.Equal(VesselC, resumed.VesselId);
            Assert.True(resumed.ResumesAfterDock);
            Assert.Equal(VesselA, ((FlightCurrent)rig.Current.Calls[^1].Payload!).VesselId);
        }

        [Fact]
        public void ACraftReleasedOnTheTimelineARewindDiscardsHasNoFlight()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha", rootPartId: "root-a"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 10.0, name: "Alpha", rootPartId: "root-a"));
            rig.Sampler.SignalReleased(VesselC, "Charlie", "root-c", 11.0);

            rig.Sampler.Sample(SnapshotFor(VesselA, 1.0, name: "Alpha", rootPartId: "root-a"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 1.1, name: "Alpha", rootPartId: "root-a"));

            Assert.DoesNotContain(rig.Started.Calls, c => ((FlightStarted)c.Payload!).VesselId == VesselC);
        }

        [Fact]
        public void AFlightReleasedWithNobodyListeningIsAnnouncedWhenItIsFlownAndSomeoneIsListening()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha", rootPartId: "root-a"));
            rig.StartedHasAudience = false;
            rig.Sampler.SignalReleased(VesselC, "Charlie", "root-c", 4.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 4.1, name: "Alpha", rootPartId: "root-a"));
            Assert.Single(rig.Started.Calls);

            rig.StartedHasAudience = true;
            rig.Sampler.Sample(SnapshotFor(VesselC, 9.0, name: "Charlie", rootPartId: "root-c"));

            var announced = (FlightStarted)rig.Started.Calls[^1].Payload!;
            Assert.Equal(VesselC, announced.VesselId);
        }

        [Fact]
        public void ACraftWhoseRootPartNeverDockedThisSessionStartsAFlightOfItsOwn()
        {
            var (rig, bravoFlight) = DockedBravoIntoAlpha();

            rig.Sampler.Sample(SnapshotFor(VesselC, 12.0, name: "Charlie", rootPartId: "root-x"));

            var started = (FlightStarted)rig.Started.Calls[^1].Payload!;
            Assert.NotEqual(bravoFlight, started.FlightId);
            Assert.False(started.ResumesAfterDock);
        }

        [Fact]
        public void ACraftDockedBeforeTheGameWasLoadedStartsAFlightOfItsOwnWhenItComesOffAnUndock()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha", rootPartId: "root-a"));

            rig.Sampler.Sample(SnapshotFor(VesselB, 5.0, name: "Bravo", rootPartId: "root-b"));

            Assert.All(rig.Started.Calls, c => Assert.False(((FlightStarted)c.Payload!).ResumesAfterDock));
            Assert.Equal(2, rig.Started.Calls.Count);
        }

        [Fact]
        public void ACraftThatDocksAndUndocksTwiceKeepsOneFlightId()
        {
            var (rig, bravoFlight) = DockedBravoIntoAlpha();
            rig.Sampler.Sample(SnapshotFor(VesselC, 12.0, name: "Bravo", rootPartId: "root-b"));
            rig.Sampler.SignalDocked(VesselC, "Bravo", VesselA, "Alpha", 20.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 20.1, name: "Alpha", rootPartId: "root-a"));
            const string VesselD = "dddddddd-0000-0000-0000-000000000000";

            rig.Sampler.Sample(SnapshotFor(VesselD, 30.0, name: "Bravo", rootPartId: "root-b"));

            var dockedEnds = rig.Ended.Calls.Select(c => (FlightEnded)c.Payload!).Where(e => e.Reason == FlightEndReason.Docked).ToList();
            Assert.Equal(2, dockedEnds.Count);
            Assert.All(dockedEnds, e => Assert.Equal(bravoFlight, e.FlightId));
            var resumed = (FlightStarted)rig.Started.Calls[^1].Payload!;
            Assert.Equal(bravoFlight, resumed.FlightId);
            Assert.Equal(VesselD, resumed.VesselId);
            Assert.True(resumed.ResumesAfterDock);
        }

        [Fact]
        public void EachCraftOfADockedStackResumesItsOwnFlightWhenItComesOff()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha", rootPartId: "root-a"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 5.0, name: "Bravo", rootPartId: "root-b"));
            var bravoFlight = ((FlightStarted)rig.Started.Calls[1].Payload!).FlightId;
            rig.Sampler.Sample(SnapshotFor(VesselC, 6.0, name: "Charlie", rootPartId: "root-c"));
            var charlieFlight = ((FlightStarted)rig.Started.Calls[2].Payload!).FlightId;
            rig.Sampler.SignalDocked(VesselB, "Bravo", VesselA, "Alpha", 9.0);
            rig.Sampler.SignalDocked(VesselC, "Charlie", VesselA, "Alpha", 9.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 9.1, name: "Alpha", rootPartId: "root-a"));
            const string VesselD = "dddddddd-0000-0000-0000-000000000000";
            const string VesselE = "eeeeeeee-0000-0000-0000-000000000000";

            rig.Sampler.Sample(SnapshotFor(VesselE, 20.0, name: "Charlie", rootPartId: "root-c"));
            rig.Sampler.Sample(SnapshotFor(VesselD, 30.0, name: "Bravo", rootPartId: "root-b"));

            var resumed = rig.Started.Calls.Select(c => (FlightStarted)c.Payload!).Where(f => f.ResumesAfterDock).ToList();
            Assert.Equal(new[] { charlieFlight, bravoFlight }, resumed.Select(f => f.FlightId).ToArray());
        }

        [Fact]
        public void ARewindForgetsWhatDocked()
        {
            var (rig, bravoFlight) = DockedBravoIntoAlpha();
            rig.Sampler.Sample(SnapshotFor(VesselA, 1.0, name: "Alpha", rootPartId: "root-a"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 1.1, name: "Alpha", rootPartId: "root-a"));

            rig.Sampler.Sample(SnapshotFor(VesselC, 12.0, name: "Bravo", rootPartId: "root-b"));

            var started = (FlightStarted)rig.Started.Calls[^1].Payload!;
            Assert.NotEqual(bravoFlight, started.FlightId);
            Assert.False(started.ResumesAfterDock);
        }

        [Fact]
        public void ALoadedGameAtALaterUtEndsTheOpenFlightsOfTheGameItReplacedAndStartsItsOwn()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 100.0, name: "Alpha"));

            rig.Sampler.NoteTimelineReset();
            rig.Sampler.Sample(SnapshotFor(VesselB, 5000.0, name: "Bravo"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 5000.1, name: "Bravo"));

            AssertEndedOnce(rig, VesselA, FlightEndReason.Reverted);
            Assert.Empty(rig.VesselChanged.Calls);
            var started = (FlightStarted)rig.Started.Calls[^1].Payload!;
            Assert.Equal(VesselB, started.VesselId);
            Assert.Equal(started.FlightId, ((FlightCurrent)rig.Current.Calls[^1].Payload!).FlightId);
        }

        [Fact]
        public void ALoadedGameAtALaterUtNeverLetsALaterRewindAnnounceTheEndOfTheGameItReplaced()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.SignalEnd(VesselA, "Alpha", FlightEndReason.Crashed, 50.0);
            rig.Sampler.Sample(SnapshotFor(VesselA, 51.0, name: "Alpha"));

            rig.Sampler.NoteTimelineReset();
            rig.Sampler.Sample(SnapshotFor(VesselB, 5000.0, name: "Bravo"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 5100.0, name: "Bravo"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 40.0, name: "Bravo"));

            var aEnds = rig.Ended.Calls.Select(c => (FlightEnded)c.Payload!).Where(e => e.VesselId == VesselA).ToList();
            Assert.Equal(FlightEndReason.Crashed, Assert.Single(aEnds).Reason);
        }

        [Fact]
        public void AVesselActiveOnlyOnTheFirstSampleAfterARewindNeverStartsAFlight()
        {
            // A load can show another vessel active for one sample before the real one.
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 10.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselB, 0.5, name: "Bravo"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 1.5, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 2.5, name: "Alpha"));

            var started = rig.Started.Calls.Select(c => (FlightStarted)c.Payload!).ToList();
            Assert.DoesNotContain(started, f => f.VesselId == VesselB);
            Assert.Equal(VesselA, started[^1].VesselId);
            Assert.Equal(1.5, started[^1].Ut);
            Assert.Empty(rig.VesselChanged.Calls);
            Assert.DoesNotContain(rig.Ended.Calls, c => ((FlightEnded)c.Payload!).VesselId == VesselB);
        }

        [Fact]
        public void ARewindStartsItsFlightOnceTheSameVesselIsActiveOnTheNextSample()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 10.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.5, name: "Alpha"));

            Assert.Single(rig.Started.Calls);
            Assert.Equal(FlightEndReason.Reverted, ((FlightEnded)Assert.Single(rig.Ended.Calls).Payload!).Reason);

            rig.Sampler.Sample(SnapshotFor(VesselA, 1.5, name: "Alpha"));

            Assert.Equal(2, rig.Started.Calls.Count);
            Assert.Equal(0.5, ((FlightStarted)rig.Started.Calls[1].Payload!).Ut);
        }

        [Fact]
        public void ACraftWithAKerbalOnEvaSaysSoOnTheFlightReadingAndKeepsItsOwnFlight()
        {
            var rig = new Rig();
            rig.Sampler.Sample(SnapshotFor(VesselA, 0.0, name: "Alpha"));
            rig.Sampler.Sample(SnapshotFor(VesselA, 5.0, name: "Alpha", evaKerbal: "Jebediah Kerman"));

            var onEva = (FlightCurrent)rig.Current.Calls[^1].Payload!;
            Assert.True(onEva.OnEva);
            Assert.Equal("Jebediah Kerman", onEva.EvaKerbalName);
            Assert.Equal(VesselA, onEva.VesselId);
            Assert.Single(rig.Started.Calls);
            Assert.Empty(rig.VesselChanged.Calls);

            rig.Sampler.Sample(SnapshotFor(VesselA, 9.0, name: "Alpha"));

            var back = (FlightCurrent)rig.Current.Calls[^1].Payload!;
            Assert.False(back.OnEva);
            Assert.Null(back.EvaKerbalName);
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
