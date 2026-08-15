using System.Collections.Generic;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for the pure, KSP-free silence/lost state machine. Uses a
    /// constant-deadline stub policy throughout so these tests exercise ONLY
    /// the tracker's own hysteresis/transition logic; the deadline formula
    /// itself is covered separately by <see cref="OrbitalPeriodSilenceDeadlinePolicyTests"/>.
    /// </summary>
    public class SilenceTrackerTests
    {
        private const string VesselA = "vessel-a";
        private const string VesselB = "vessel-b";

        private static SilenceTracker NewTracker(double deadlineSec = 100.0, string basis = "policy-ceiling") =>
            new SilenceTracker((orbit, landed) => new SilenceDeadline(deadlineSec, basis));

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
        public void ArmingSampleAloneNeverDeclaresLostEvenWhenTheDeadlineIsZero()
        {
            // The arming sample (Nominal -> Silent) always returns before the
            // declare-eligibility check runs: structurally, at least ONE
            // MORE silent sample is required, however small the deadline.
            var tracker = NewTracker(deadlineSec: 0);

            tracker.Tick(One(VesselA, false), ut: 100);

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Silent, state.State);
            Assert.Equal(0, state.LostSeq);
        }

        [Fact]
        public void AReconnectInterruptingASilentRunResetsTheHysteresisRatherThanCarryingTheOldDeadline()
        {
            var tracker = NewTracker(deadlineSec: 10);

            tracker.Tick(One(VesselA, false), ut: 0); // arm: deadline = 10
            tracker.Tick(One(VesselA, true), ut: 5); // reconnect clears it before the deadline
            tracker.Tick(One(VesselA, false), ut: 20); // arms a FRESH run: deadline = 30

            // Even though ut=20 is past the OLD deadline (10), the run was
            // interrupted, so this is a fresh single arming sample and must
            // not declare Lost.
            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Silent, state.State);
            Assert.Equal(30, state.DeadlineUt);
            Assert.Equal(0, state.LostSeq);
        }

        [Fact]
        public void DeclaresLostOnceBothTheDeadlineAndTwoConsecutiveSilentSamplesAgree()
        {
            var tracker = NewTracker(deadlineSec: 10);

            tracker.Tick(One(VesselA, false), ut: 0); // arm: deadline = 10, consecutive=1
            tracker.Tick(One(VesselA, false), ut: 15); // consecutive=2, past deadline -> Lost

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Lost, state.State);
            Assert.Equal(15, state.DeclaredLostUt);
            Assert.Equal(1, state.LostSeq);
        }

        [Fact]
        public void DoesNotDeclareLostBeforeTheDeadlineEvenWithManyConsecutiveSilentSamples()
        {
            var tracker = NewTracker(deadlineSec: 1000);

            tracker.Tick(One(VesselA, false), ut: 0);
            tracker.Tick(One(VesselA, false), ut: 1);
            tracker.Tick(One(VesselA, false), ut: 2);

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Silent, state.State);
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
        public void OneConnectedSampleClearsLostInstantlyAndAReLossGetsAFreshSeq()
        {
            var tracker = NewTracker(deadlineSec: 10);

            tracker.Tick(One(VesselA, false), ut: 0);
            tracker.Tick(One(VesselA, false), ut: 15); // Lost, seq=1
            Assert.Equal(SilenceState.Lost, tracker.TryGetState(VesselA)!.State);

            tracker.Tick(One(VesselA, true), ut: 20); // reconnect clears it
            var cleared = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Nominal, cleared.State);
            Assert.Equal(1, cleared.LostSeq); // seq is not reset on clear

            tracker.Tick(One(VesselA, false), ut: 30);
            tracker.Tick(One(VesselA, false), ut: 45); // re-declared -> seq bumps again
            var relost = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Lost, relost.State);
            Assert.Equal(2, relost.LostSeq);
        }

        [Fact]
        public void VesselMissingFromTheFleetIsDeclaredDestroyedImmediately()
        {
            var tracker = NewTracker();

            tracker.Tick(One(VesselA, true), ut: 0);
            var result = tracker.Tick(new SilenceSample[0], ut: 1); // vessel-a absent this tick

            Assert.Single(result);
            Assert.Equal(SilenceState.Lost, result[0].State);
            Assert.Equal(SilenceDeadlineBasis.Destroyed, result[0].DeadlineBasis);
            Assert.Null(result[0].DeadlineUt);
            Assert.Equal(1, result[0].LostSeq);
            Assert.False(result[0].Connected);
        }

        [Fact]
        public void DestroyedNeverGoesThroughTheDeadlinePolicyAndDoesNotReincrementSeqOnRepeatedAbsence()
        {
            var callCount = 0;
            var tracker = new SilenceTracker((orbit, landed) =>
            {
                callCount++;
                return new SilenceDeadline(100, "policy-ceiling");
            });

            tracker.Tick(One(VesselA, true), ut: 0);
            tracker.Tick(new SilenceSample[0], ut: 1); // destroyed
            tracker.Tick(new SilenceSample[0], ut: 2); // still absent

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Lost, state.State);
            Assert.Equal(1, state.LostSeq); // no re-increment on repeated absence
            Assert.Equal(0, callCount); // destroyed never asks the deadline policy
        }

        [Fact]
        public void RestoredSilentStateRequiresTwoFreshConsecutiveSamplesEvenIfAlreadyPastDeadline()
        {
            var tracker = NewTracker();

            // Simulate a reload: the vessel was already Silent with a deadline
            // that has already passed at "now".
            tracker.RestoreState(new VesselContactState
            {
                VesselId = VesselA,
                State = SilenceState.Silent,
                SilenceSinceUt = 0,
                DeadlineUt = 5,
                DeadlineBasis = "policy-ceiling",
            });

            tracker.Tick(One(VesselA, false), ut: 100); // 1st fresh sample, deadline already passed
            Assert.Equal(SilenceState.Silent, tracker.TryGetState(VesselA)!.State);

            tracker.Tick(One(VesselA, false), ut: 101); // 2nd fresh sample -> now eligible
            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Lost, state.State);
            Assert.Equal(1, state.LostSeq);
        }

        [Fact]
        public void RestoredLostStateStaysLostWithoutReincrementingSeq()
        {
            var tracker = NewTracker();

            tracker.RestoreState(new VesselContactState
            {
                VesselId = VesselA,
                State = SilenceState.Lost,
                DeclaredLostUt = 50,
                LostSeq = 3,
            });

            tracker.Tick(One(VesselA, false), ut: 100);

            var state = tracker.TryGetState(VesselA)!;
            Assert.Equal(SilenceState.Lost, state.State);
            Assert.Equal(3, state.LostSeq);
            Assert.Equal(50, state.DeclaredLostUt);
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
            Assert.Equal(SilenceState.Lost, tracker.TryGetState(VesselB)!.State);
        }
    }
}
