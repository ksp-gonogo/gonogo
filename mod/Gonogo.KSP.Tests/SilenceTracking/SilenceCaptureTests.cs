using System;
using System.Collections.Generic;
using Gonogo.KSP.SilenceTracking;
using Gonogo.KSP.Tests.Comms;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.SilenceTracking
{
    /// <summary>
    /// What the silence capture hands the tracker each tick from the game's
    /// vessel list: one sample per vessel, in contact exactly when the vessel's
    /// own link says it is connected.
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class SilenceCaptureTests
    {
        private const double Ut = 500.0;

        private static readonly Guid CraftId = new Guid("22222222-0000-0000-0000-000000000000");
        private static readonly Guid OtherId = new Guid("33333333-0000-0000-0000-000000000000");

        private static SignalDelayConfig DelayOn() => new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        private static SilenceTracker Tracker() =>
            new SilenceTracker((sample, onsetUt) => new SilenceDeadline(1_000.0, SilenceDeadlineBasis.PolicyCeiling));

        private static SilenceState StateAfterOneCapture(UnityStandIns ksp, Vessel craft)
        {
            var tracker = Tracker();
            new FleetSilenceChannels().CaptureSilence(tracker, new List<Vessel> { craft }, Ut);
            return tracker.TryGetState(craft.id.ToString())!.State;
        }

        [Fact]
        public void ACraftWhoseLinkIsConnectedIsNominal()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());

            Assert.Equal(SilenceState.Nominal, StateAfterOneCapture(ksp, UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: true))));
        }

        [Fact]
        public void ACraftWhoseLinkIsDownIsSilent()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());

            Assert.Equal(SilenceState.Silent, StateAfterOneCapture(ksp, UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: false))));
        }

        [Fact]
        public void ACraftWithNoLinkToReadIsSilent()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());

            Assert.Equal(SilenceState.Silent, StateAfterOneCapture(ksp, UnityStandIns.Craft(CraftId)));
        }

        /// <summary>
        /// Connected is the link's own flag, which a path ending at another craft
        /// sets as readily as one ending at the ground.
        /// </summary>
        [Fact]
        public void ACraftConnectedOnlyThroughAnotherCraftIsNominal()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());
            var craft = UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: true, UnityStandIns.Hop(1_000.0, endsAtHome: false)));

            Assert.Equal(SilenceState.Nominal, StateAfterOneCapture(ksp, craft));
        }

        [Fact]
        public void DebrisIsTrackedLikeAnyCraft()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());

            Assert.Equal(SilenceState.Silent, StateAfterOneCapture(ksp, UnityStandIns.Craft(CraftId, type: VesselType.Debris)));
        }

        [Fact]
        public void InASaveWithNoCommsModelACraftWithNoLinkIsNominal()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());
            CommsCoreUplink.ConfigureCommsModelProbe(() => false);

            Assert.Equal(SilenceState.Nominal, StateAfterOneCapture(ksp, UnityStandIns.Craft(CraftId)));
        }

        [Fact]
        public void ACraftThatLeavesTheVesselListIsDeclaredDestroyedOnTheNextCapture()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());
            var craft = UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: true));
            var other = UnityStandIns.Craft(OtherId, UnityStandIns.Link(connected: true));
            var tracker = Tracker();
            var capture = new FleetSilenceChannels();

            capture.CaptureSilence(tracker, new List<Vessel> { craft, other }, Ut);
            capture.CaptureSilence(tracker, new List<Vessel> { other }, Ut + 1.0);

            var state = tracker.TryGetState(CraftId.ToString())!;
            Assert.Equal(SilenceState.Lost, state.State);
            Assert.Equal(SilenceDeadlineBasis.Destroyed, state.DeadlineBasis);
            Assert.Equal(Ut + 1.0, state.DeclaredLostUt);
        }

        [Fact]
        public void WithNoTrackerBoundNothingIsCaptured()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());
            SilenceTrackerSink.Unbind();

            Assert.Null(new FleetSilenceChannels().CaptureSilenceOnMain(null));
        }
    }
}
