using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests.FlightOps
{
    /// <summary>The rule lives in a file that needs a running game, so its wiring to the guards is held by its source.</summary>
    public class QuicksaveHonoursSaveGuardsTests
    {
        [Fact]
        public void TheQuicksaveRuleAsksTheGuards()
        {
            var rule = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspQuicksaves.cs"),
                "internal static bool QuicksaveAllowedNow()");
            Assert.Contains("SaveGuards.AnyForbids(Kernel)", rule);
        }

        /// <summary>A frame published before the timeline reset is discarded with the old timeline, so a finished load was announced to no screen.</summary>
        [Fact]
        public void AFinishedLoadIsAnnouncedFromTheResetNotBeforeIt()
        {
            var complete = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspQuicksaves.cs"),
                "private static void Complete(PendingLoad pending, ConfigNode node, Version originalVersion)");
            Assert.DoesNotContain("Publish(", complete);
            Assert.Contains("OnTimelineReset(KspQuicksaves.OnTimelineReset)", CurrencyDelaySourceText.ReadRelative("FlightOpsUplink.cs"));
        }

        /// <summary>The slots published as a game loads are discarded by its first reset, so a screen saw no quicksave until the next save.</summary>
        [Fact]
        public void TheSlotsAreReadAgainAfterEveryReset()
        {
            var reset = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspQuicksaves.cs"),
                "internal static void OnTimelineReset()");
            Assert.Contains("_slotsDirty = true", reset);
        }

        /// <summary>A screen that subscribes after the last change is sent the slots only when they are offered again.</summary>
        [Fact]
        public void UnchangedSlotsAreStillOfferedForALateSubscriber()
        {
            var publish = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspQuicksaves.cs"),
                "internal static void PublishSlotsIfChanged(IChannelPublisher publisher)");
            Assert.Contains("publisher.Publish(_slots, offeredAtUt)", publish);
        }

        [Fact]
        public void TheCapabilityIsDeclaredBeforeAnyUplinkRegistersAGuard()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("FlightOpsUplink.cs");
            Assert.Contains("IUplinkCapabilityDeclarer", uplink);
            Assert.Contains("Id = SaveGuardCapability.Id", uplink);
        }
    }
}
