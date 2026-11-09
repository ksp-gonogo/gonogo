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

        /// <summary>The slots were left to a one-second check and a background read, so a reset or a quicksave showed the previous slot for about two seconds.</summary>
        [Fact]
        public void AResetAndAQuicksaveHaveTheSlotsPublishedOnTheNextTick()
        {
            var text = CurrencyDelaySourceText.ReadRelative("KspQuicksaves.cs");
            Assert.Contains("_publishNow = true", CurrencyDelaySourceText.MethodBody(text, "internal static void OnTimelineReset()"));
            Assert.Contains("_publishNow = true", CurrencyDelaySourceText.MethodBody(text, "internal static CommandResult<SaveWritten> Quicksave()"));
            var publish = CurrencyDelaySourceText.MethodBody(text, "internal static void PublishSlotsIfChanged(IChannelPublisher publisher)");
            Assert.Contains("PublishSlotsNow(publisher)", publish);
            Assert.Contains("publisher.Publish(slots, readAtUt)", CurrencyDelaySourceText.MethodBody(text, "private static bool PublishSlotsNow(IChannelPublisher publisher)"));
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

        /// <summary>A load done in the game announced nothing, so no screen said the game had loaded.</summary>
        [Fact]
        public void ALoadDoneInTheGameIsAnnouncedAtTheReset()
        {
            var reporter = CurrencyDelaySourceText.ReadRelative("GameLoadReporter.cs");
            Assert.Contains("KspQuicksaves.NoteLoadedInGame(node)", reporter);
            var note = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspQuicksaves.cs"),
                "internal static void NoteLoadedInGame(ConfigNode node)");
            Assert.Contains("if (LoadScheduled)", note);
            Assert.Contains("_loadedAwaitingReset", note);
            // Unstamped, the poll that announces a load no reset answered fires at once, before the reset, and the old timeline discards the frame.
            Assert.Contains("_loadedAt = Time.realtimeSinceStartup", note);
        }
    }
}
