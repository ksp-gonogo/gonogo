using System.Collections.Generic;
using System.Linq;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for the pure, KSP-free silence state machine. Uses a
    /// constant-deadline stub policy throughout so these tests exercise only
    /// the tracker's own transition logic; the deadline formula
    /// itself is covered separately by <see cref="OrbitalPeriodSilenceDeadlinePolicyTests"/>.
    /// </summary>
    public class SilenceTrackerTests
    {
        private const string VesselA = "vessel-a";
        private const string VesselB = "vessel-b";

        private static SilenceTracker NewTracker(double deadlineSec = 100.0, string basis = "policy-ceiling") =>
            new SilenceTracker((sample, onsetUt) => new SilenceDeadline(deadlineSec, basis));

        private static IReadOnlyList<SilenceSample> One(string id, bool connected) =>
            new[] { new SilenceSample(id, connected, orbit: null, landedOrSplashed: false) };

        [Fact]
        public void StaysNominalWhileConnectedAndTracksLastContactUt()
        {
            var tracker = NewTracker();

            tracker.Tick(One(VesselA, true), ut: 10);
            tracker.Tick(One(VesselA, true), ut: 20);

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Nominal, state.State);
            Assert.Equal(20, state.LastContactUt);
            Assert.Null(state.SilenceSinceUt);
            Assert.Null(state.DeadlineUt);
        }

        [Fact]
        public void FirstSilentSampleArmsTheClockUsingThePolicy()
        {
            var tracker = NewTracker(deadlineSec: 300, basis: "orbital-period");

            tracker.Tick(One(VesselA, true), ut: 0);
            tracker.Tick(One(VesselA, false), ut: 10);

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Silent, state.State);
            Assert.Equal(10, state.SilenceSinceUt);
            Assert.Equal(310, state.DeadlineUt);
            Assert.Equal("orbital-period", state.DeadlineBasis);
        }

        [Fact]
        public void AReconnectInterruptingASilentRunArmsAFreshDeadlineRatherThanCarryingTheOldOne()
        {
            var tracker = NewTracker(deadlineSec: 10);

            tracker.Tick(One(VesselA, false), ut: 0); // arm: deadline = 10
            tracker.Tick(One(VesselA, true), ut: 5); // reconnect clears it before the deadline
            tracker.Tick(One(VesselA, false), ut: 20); // arms a FRESH run: deadline = 30

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Silent, state.State);
            Assert.Equal(30, state.DeadlineUt);
        }

        [Fact]
        public void ASilentCraftPastItsDeadlineStaysSilentForTheGroundToJudge()
        {
            var tracker = NewTracker(deadlineSec: 10);

            tracker.Tick(One(VesselA, false), ut: 0);
            tracker.Tick(One(VesselA, false), ut: 15);
            tracker.Tick(One(VesselA, false), ut: 30);

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Silent, state.State);
            Assert.Equal(10, state.DeadlineUt);
        }

        [Fact]
        public void OneConnectedSampleClearsSilentInstantly()
        {
            var tracker = NewTracker(deadlineSec: 10);

            tracker.Tick(One(VesselA, false), ut: 0);
            tracker.Tick(One(VesselA, true), ut: 1);

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Nominal, state.State);
            Assert.Null(state.SilenceSinceUt);
            Assert.Null(state.DeadlineUt);
            Assert.Null(state.DeadlineBasis);
        }

        [Fact]
        public void ACraftCalledDestroyedThatReappearsWithoutALinkStaysDestroyedAndOutOfTheLiveFleet()
        {
            var tracker = NewTracker();

            tracker.Tick(One(VesselA, true), ut: 0);
            tracker.Tick(new SilenceSample[0], ut: 1);
            tracker.Tick(One(VesselA, false), ut: 2);

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Gone, state.State);
            Assert.Equal(SilenceDeadlineBasis.Destroyed, state.DeadlineBasis);
            Assert.Empty(tracker.LiveStates);
        }

        [Fact]
        public void ACraftCalledDestroyedThatReappearsWithALinkIsNominalAndLiveAgain()
        {
            var tracker = NewTracker();

            tracker.Tick(One(VesselA, true), ut: 0);
            tracker.Tick(new SilenceSample[0], ut: 1);
            tracker.Tick(One(VesselA, true), ut: 2);

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Nominal, state.State);
            Assert.Single(tracker.LiveStates);
        }

        [Fact]
        public void VesselMissingFromTheFleetIsGoneImmediately()
        {
            var tracker = NewTracker();

            tracker.Tick(One(VesselA, true), ut: 0);
            var result = tracker.Tick(new SilenceSample[0], ut: 1); // vessel-a absent this tick

            Assert.Single(result);
            Assert.Equal(SilenceState.Gone, result[0].State);
            Assert.Equal(SilenceDeadlineBasis.Destroyed, result[0].DeadlineBasis);
            Assert.Null(result[0].DeadlineUt);
            Assert.False(result[0].Connected);
        }

        [Fact]
        public void AGoneCraftNeverGoesThroughTheDeadlinePolicy()
        {
            var callCount = 0;
            var tracker = new SilenceTracker((sample, onsetUt) =>
            {
                callCount++;
                return new SilenceDeadline(100, "policy-ceiling");
            });

            tracker.Tick(One(VesselA, true), ut: 0);
            tracker.Tick(new SilenceSample[0], ut: 1); // destroyed
            tracker.Tick(new SilenceSample[0], ut: 2); // still absent

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Gone, state.State);
            Assert.Equal(0, callCount); // destroyed never asks the deadline policy
        }

        [Fact]
        public void LiveStatesGrowWithTheFleetThatExistsRatherThanWithEveryVesselEverTracked()
        {
            var tracker = NewTracker();
            var launched = new List<SilenceSample>();
            for (var i = 0; i < 1000; i++)
            {
                launched.Add(new SilenceSample("debris-" + i, true, orbit: null, landedOrSplashed: false));
            }
            tracker.Tick(launched, ut: 0);
            tracker.Tick(One(VesselA, true), ut: 1); // every debris piece is now gone

            Assert.Equal(1001, tracker.States.Count);
            var live = tracker.LiveStates.ToList();
            Assert.Single(live);
            Assert.Equal(VesselA, live[0].VesselId);
        }

        [Fact]
        public void ADestroyedVesselIsReportedOnceRatherThanOnEverySampleAfterwards()
        {
            var tracker = NewTracker();
            var launched = new List<SilenceSample>();
            for (var i = 0; i < 1000; i++)
            {
                launched.Add(new SilenceSample("debris-" + i, true, orbit: null, landedOrSplashed: false));
            }
            tracker.Tick(launched, ut: 0);

            var reports = 0;
            for (var ut = 1; ut <= 50; ut++)
            {
                reports += tracker.Tick(One(VesselA, true), ut).Count(s => s.VesselId != VesselA);
            }

            Assert.Equal(1000, reports);
        }

        [Fact]
        public void ARestoredDestroyedVesselIsReportedOnceThisSession()
        {
            var tracker = NewTracker();
            tracker.RestoreState(new VesselContactState
            {
                VesselId = VesselB,
                State = SilenceState.Gone,
                DeadlineBasis = SilenceDeadlineBasis.Destroyed,
            });

            var first = tracker.Tick(One(VesselA, true), ut: 1);
            var second = tracker.Tick(One(VesselA, true), ut: 2);

            Assert.Contains(first, s => s.VesselId == VesselB);
            Assert.DoesNotContain(second, s => s.VesselId == VesselB);
        }

        [Fact]
        public void AVesselThatReturnsAndIsDestroyedAgainIsReportedAgain()
        {
            var tracker = NewTracker();
            tracker.Tick(One(VesselA, true), ut: 0);
            tracker.Tick(new SilenceSample[0], ut: 1);
            tracker.Tick(One(VesselA, true), ut: 2);

            var again = tracker.Tick(new SilenceSample[0], ut: 3);

            Assert.Single(again);
            Assert.Equal(VesselA, again[0].VesselId);
        }

        [Fact]
        public void TracksMultipleVesselsIndependently()
        {
            var tracker = NewTracker(deadlineSec: 10);

            tracker.Tick(new[]
            {
                new SilenceSample(VesselA, true, null, false),
                new SilenceSample(VesselB, false, null, false),
            }, ut: 0);

            tracker.Tick(new[]
            {
                new SilenceSample(VesselA, true, null, false),
                new SilenceSample(VesselB, false, null, false),
            }, ut: 20);

            Assert.Equal(SilenceState.Nominal, tracker.TryGetState(VesselA)!.State);
            Assert.Equal(SilenceState.Silent, tracker.TryGetState(VesselB)!.State);
            Assert.Equal(10, tracker.TryGetState(VesselB)!.DeadlineUt);
        }

        /// <summary>
        /// Every verdict the deadline policy can reach has to be able to
        /// replace the armed orbital-period basis on the wire, including the
        /// ones that decline to predict.
        ///
        /// <para>Written as a loop over the whole vocabulary rather than one
        /// case, because the tracker recognises verdicts through a hand-listed
        /// predicate and a basis added to the policy without being added there
        /// falls out of it in total silence: the wire keeps reporting
        /// <c>orbital-period</c> forever and a working sweep is indistinguishable
        /// from one that never ran. That is the exact failure the upgrade path's
        /// own comment records having already been shipped once.</para>
        /// </summary>
        [Theory]
        [InlineData(SilenceDeadlineBasis.PredictedReacquisition)]
        [InlineData(SilenceDeadlineBasis.NoOccultation)]
        [InlineData(SilenceDeadlineBasis.NoEmergenceInWindow)]
        [InlineData(SilenceDeadlineBasis.WarpLimited)]
        [InlineData(SilenceDeadlineBasis.GraceExceedsCeiling)]
        [InlineData(SilenceDeadlineBasis.HorizonLimited)]
        public void EveryPolicyVerdictReachesTheWire(string verdict)
        {
            // Arms on the first silent tick with the fallback basis, the way a
            // save load does when no geometry can be had yet, then answers with
            // the verdict once asked again.
            var armed = false;
            var tracker = new SilenceTracker((sample, onsetUt) =>
            {
                if (!armed)
                {
                    armed = true;
                    return new SilenceDeadline(10_000.0, SilenceDeadlineBasis.OrbitalPeriod);
                }
                return new SilenceDeadline(10_000.0, verdict);
            });

            tracker.Tick(One(VesselA, true), ut: 0);
            tracker.Tick(One(VesselA, false), ut: 10);
            Assert.Equal(SilenceDeadlineBasis.OrbitalPeriod, tracker.TryGetState(VesselA)!.DeadlineBasis);

            tracker.Tick(One(VesselA, false), ut: 20);

            Assert.Equal(verdict, tracker.TryGetState(VesselA)!.DeadlineBasis);
        }

        /// <summary>
        /// The control for the loop above: a basis that is not a verdict, i.e.
        /// the policy falling back because it could not look at all, must leave
        /// the armed basis alone and keep its one retry.
        /// </summary>
        [Fact]
        public void AFallbackBasisDoesNotSpendTheUpgrade()
        {
            var tracker = new SilenceTracker((sample, onsetUt) =>
                new SilenceDeadline(10_000.0, SilenceDeadlineBasis.PolicyCeiling));

            tracker.Tick(One(VesselA, true), ut: 0);
            tracker.Tick(One(VesselA, false), ut: 10);
            tracker.Tick(One(VesselA, false), ut: 20);

            Assert.Equal(SilenceDeadlineBasis.PolicyCeiling, tracker.TryGetState(VesselA)!.DeadlineBasis);
        }
    }
}
