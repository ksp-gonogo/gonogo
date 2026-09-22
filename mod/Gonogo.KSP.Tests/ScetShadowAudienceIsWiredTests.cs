using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// That the command-vantage (audience) alarm arm is wired the way its
    /// correctness depends on, and that it is still SHADOW.
    ///
    /// <para><b>Why source text.</b> The decision-making halves are behavioural
    /// suites elsewhere: <c>ScetAlarmRosterTests</c> for what a roster decides
    /// and <c>RevealedScetStateReaderTests</c> for what one vantage has been
    /// told. Neither can say anything about which THREAD the audience
    /// evaluation runs on, or about whether its warp stop is acted on, and
    /// <c>ScetAlarmUplink</c> needs a live scene (it reads <c>Planetarium</c>
    /// and commands the game's warp) so there is no other way to ask from here.
    /// Same technique and the same reason as
    /// <c>ScetThresholdSeamIsWiredTests</c> next door.</para>
    /// </summary>
    public class ScetShadowAudienceIsWiredTests
    {
        /// <summary>
        /// The audience evaluation runs on the COURIER, and this is the one
        /// assertion here that is about a crash rather than about a rule. The
        /// archive it reads is the Courier's own state and nothing guards it;
        /// the capture runs on the Unity main thread while the Courier thread is
        /// free, so the same call from there is a data race with sample
        /// recording.
        /// </summary>
        [Fact]
        public void the_audience_rosters_are_evaluated_on_the_courier_thread()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

            var handle = CurrencyDelaySourceText.MethodBody(
                uplink, "private void HandleOnCourier(object? captured)");
            Assert.Contains("new RevealedScetStateReader(", handle, StringComparison.Ordinal);

            var capture = CurrencyDelaySourceText.MethodBody(
                uplink, "private object? CaptureOnMain(KspSnapshot? snapshot)");
            Assert.DoesNotContain("RevealedScetStateReader", capture, StringComparison.Ordinal);
            Assert.DoesNotContain("_commandRosters", capture, StringComparison.Ordinal);
        }

        /// <summary>
        /// An audience verdict stops nothing. Warp is a property of the
        /// simulation, and what one command centre has been told is not a fact
        /// about the simulation: halting the game on a light-time-old reading
        /// would stop it for everybody, for an event that already happened, on
        /// one vantage's say-so.
        /// </summary>
        [Fact]
        public void an_audience_verdict_never_touches_the_warp()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");
            var handle = CurrencyDelaySourceText.MethodBody(
                uplink, "private void HandleOnCourier(object? captured)");

            Assert.DoesNotContain("SetWarp", handle, StringComparison.Ordinal);
            Assert.DoesNotContain("WarpStopBudget", handle, StringComparison.Ordinal);

            // And the simulation's own verdict still does, so this is a check on
            // WHICH roster commands the warp rather than on the feature having
            // been removed.
            var capture = CurrencyDelaySourceText.MethodBody(
                uplink, "private object? CaptureOnMain(KspSnapshot? snapshot)");
            Assert.Contains("_actuator.SetWarp(0)", capture, StringComparison.Ordinal);
        }

        /// <summary>
        /// The capture hands the handle a payload on EVERY tick, including one
        /// with nothing to say. <c>ScetRosterAudience</c> lives in the handle
        /// now and has to be told about a tick where nobody is subscribed: that
        /// is how it learns to answer the next subscriber. A capture that
        /// returned null on a quiet tick would leave a reconnecting client
        /// waiting on a roster frame that never comes, which is the failure that
        /// class exists for.
        /// </summary>
        [Fact]
        public void the_capture_never_skips_the_handle()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");
            var capture = CurrencyDelaySourceText.MethodBody(
                uplink, "private object? CaptureOnMain(KspSnapshot? snapshot)");

            // The only `return null` left is the fail-soft in the catch.
            var beforeCatch = capture.IndexOf("catch (Exception", StringComparison.Ordinal);
            Assert.True(beforeCatch > 0, "CaptureOnMain no longer fail-softs");
            Assert.DoesNotContain("return null", capture.Substring(0, beforeCatch), StringComparison.Ordinal);
        }

        /// <summary>
        /// The read is installed from the addon, and TAKEN AWAY at shutdown. It
        /// is a static closure over one engine: left in place it would outlive
        /// the archive it reads and hand the next scene's alarm arm a dead one.
        /// </summary>
        [Fact]
        public void the_addon_installs_the_read_and_drops_it_again()
        {
            var addon = CurrencyDelaySourceText.ReadRelative("GonogoAddon.cs");

            Assert.Contains(
                "ScetAlarmUplink.ConfigureRevealedRead(", addon, StringComparison.Ordinal);

            var shutdown = CurrencyDelaySourceText.MethodBody(addon, "private void Shutdown()");
            Assert.Contains(
                "ScetAlarmUplink.ConfigureRevealedRead(null)", shutdown, StringComparison.Ordinal);
        }

        /// <summary>
        /// The standing subscriptions are installed and dropped the same way and
        /// for the same reason, and they are what gives the revealed read
        /// anything to answer from: the archive holds only what something is
        /// subscribed to, so without them an audience threshold reads whichever
        /// Topics a widget happens to be showing.
        /// </summary>
        [Fact]
        public void the_addon_installs_the_standing_subscriptions_and_drops_them_again()
        {
            var addon = CurrencyDelaySourceText.ReadRelative("GonogoAddon.cs");

            Assert.Contains(
                "ScetAlarmUplink.ConfigureStandingSubscriptions(", addon, StringComparison.Ordinal);
            Assert.Contains("engine.OpenStandingSubscription(", addon, StringComparison.Ordinal);
            Assert.Contains("engine.CloseStandingSubscription(", addon, StringComparison.Ordinal);

            var shutdown = CurrencyDelaySourceText.MethodBody(addon, "private void Shutdown()");
            Assert.Contains(
                "ScetAlarmUplink.ConfigureStandingSubscriptions(null, null)",
                shutdown,
                StringComparison.Ordinal);
        }

        /// <summary>
        /// The reconciliation runs on the handle, where the roster's OWN changes
        /// are visible: a rewind clear and an alarm going Unreachable are decided
        /// inside an evaluation and reach no command handler, so an arm and
        /// disarm pair would keep a Topic held for an alarm that no longer
        /// exists.
        /// </summary>
        [Fact]
        public void the_standing_subscriptions_are_reconciled_from_the_handle()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

            var handle = CurrencyDelaySourceText.MethodBody(
                uplink, "private void HandleOnCourier(object? captured)");
            Assert.Contains("_subscriptions.Reconcile(", handle, StringComparison.Ordinal);

            foreach (var handler in new[]
            {
                "private CommandResult HandleArm(ScetAlarmArmArgs? args, string vantage)",
                "private CommandResult HandleDisarm(ScetAlarmDisarmArgs? args)",
            })
            {
                Assert.DoesNotContain(
                    "_subscriptions.Reconcile(",
                    CurrencyDelaySourceText.MethodBody(uplink, handler),
                    StringComparison.Ordinal);
            }
        }
    }
}
