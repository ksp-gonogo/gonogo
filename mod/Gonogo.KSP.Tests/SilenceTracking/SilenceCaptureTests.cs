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
    /// route ends at a ground station, the ground being where the forecast's
    /// geometry and the home centre's hearing both stand.
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
            new SilenceForecasts().CaptureSilence(tracker, new List<Vessel> { craft }, Ut);
            return tracker.TryGetState(craft.id.ToString())!.State;
        }

        [Fact]
        public void ACraftWhoseRouteEndsAtTheGroundIsNominal()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());

            Assert.Equal(SilenceState.Nominal, StateAfterOneCapture(ksp, UnityStandIns.Craft(CraftId, Grounded())));
        }

        private static CommNet.CommNetVessel Grounded() => UnityStandIns.Link(connected: true, UnityStandIns.Hop(1_000.0, endsAtHome: true));

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
        /// The link's own flag is set for a path ending at another craft as
        /// readily as one ending at the ground, so it is not what is read: the
        /// ground cannot hear such a craft.
        /// </summary>
        [Fact]
        public void ACraftConnectedOnlyThroughAnotherCraftIsSilent()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());
            var craft = UnityStandIns.Craft(CraftId, UnityStandIns.Link(connected: true, UnityStandIns.Hop(1_000.0, endsAtHome: false)));

            Assert.Equal(SilenceState.Silent, StateAfterOneCapture(ksp, craft));
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
        public void ACraftThatLeavesTheVesselListIsGoneOnTheNextCapture()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());
            var craft = UnityStandIns.Craft(CraftId, Grounded());
            var other = UnityStandIns.Craft(OtherId, Grounded());
            var tracker = Tracker();
            var capture = new SilenceForecasts();

            capture.CaptureSilence(tracker, new List<Vessel> { craft, other }, Ut);
            capture.CaptureSilence(tracker, new List<Vessel> { other }, Ut + 1.0);

            var state = tracker.TryGetState(CraftId.ToString())!;
            Assert.Equal(SilenceState.Gone, state.State);
            Assert.Equal(SilenceDeadlineBasis.Destroyed, state.DeadlineBasis);
        }

        [Fact]
        public void WithNoTrackerBoundNothingIsCaptured()
        {
            using var ksp = new UnityStandIns(Ut, DelayOn());
            SilenceTrackerSink.Unbind();

            Assert.Null(new SilenceForecasts().CaptureSilenceOnMain(null));
        }
    }
}
