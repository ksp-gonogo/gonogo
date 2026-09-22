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
        /// The alarms that read the archive are evaluated on the COURIER, and
        /// this is the one assertion here that is about a crash rather than about
        /// a rule. The archive is the Courier's own state and nothing guards it;
        /// the capture runs on the Unity main thread while the Courier thread is
        /// free, so the same call from there is a data race with sample
        /// recording.
        ///
        /// <para>The split is by WHERE an alarm reads, so what says the capture
        /// stayed on its own side is the predicate it passes and the reader it
        /// builds, not which roster it reaches for.</para>
        /// </summary>
        [Fact]
        public void the_alarms_that_read_the_archive_are_evaluated_on_the_courier_thread()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

            var handle = CurrencyDelaySourceText.MethodBody(
                uplink, "private void HandleOnCourier(object? captured)");
            Assert.Contains(
                "alarm => !ScetAlarmVantage.IsTheSubjectsOwn(alarm)", handle, StringComparison.Ordinal);

            var capture = CurrencyDelaySourceText.MethodBody(
                uplink, "private object? CaptureOnMain(KspSnapshot? snapshot)");
            Assert.Contains(
                "ScetAlarmVantage.IsTheSubjectsOwn", capture, StringComparison.Ordinal);
            Assert.DoesNotContain("RevealedScetStateReader", capture, StringComparison.Ordinal);
        }

        /// <summary>
        /// One roster. The per-audience dictionary held nothing an
        /// <c>Entry</c> does not already carry, and duplicated the two things
        /// that are once-per-tick: the rewind clear and the off-tick change flag.
        /// </summary>
        [Fact]
        public void there_is_one_roster_and_the_tick_is_split_by_pass()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

            Assert.DoesNotContain("_commandRosters", uplink, StringComparison.Ordinal);
            Assert.DoesNotContain("SnapshotAll", uplink, StringComparison.Ordinal);

            var capture = CurrencyDelaySourceText.MethodBody(
                uplink, "private object? CaptureOnMain(KspSnapshot? snapshot)");
            Assert.Contains("_roster.BeginTick(ut)", capture, StringComparison.Ordinal);

            var handle = CurrencyDelaySourceText.MethodBody(
                uplink, "private void HandleOnCourier(object? captured)");
            Assert.Contains("_roster.EndTick(publish.Tick)", handle, StringComparison.Ordinal);
        }

        /// <summary>
        /// EVERY alarm stops the warp, wherever it is read. The vantage decides
        /// WHEN, never WHETHER, so the pass that reads the archive commands the
        /// stop for what it decided just as the capture does for its own.
        ///
        /// <para>Both halves, because the two would otherwise drift apart: this
        /// used to assert the opposite for the handle, and a stop moved one call
        /// deep would have kept that passing while the rule inverted underneath
        /// it.</para>
        /// </summary>
        [Fact]
        public void every_vantage_stops_the_warp_from_the_thread_that_decided_it()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

            var handle = CurrencyDelaySourceText.MethodBody(
                uplink, "private void HandleOnCourier(object? captured)");
            Assert.Contains("StopWarpFromHandle(", handle, StringComparison.Ordinal);

            var capture = CurrencyDelaySourceText.MethodBody(
                uplink, "private object? CaptureOnMain(KspSnapshot? snapshot)");
            Assert.Contains("_actuator.SetWarp(0)", capture, StringComparison.Ordinal);
        }

        /// <summary>
        /// The handle's stop is MARSHALLED and waited on, never left for the next
        /// capture. <c>TimeWarp.SetRate</c> is main-thread only, and a capture
        /// away is one snapshot cadence, which under warp is thousands of seconds
        /// of the precision the alarm was armed for.
        /// </summary>
        [Fact]
        public void the_handles_stop_crosses_a_thread_and_not_a_tick()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");
            var stop = CurrencyDelaySourceText.MethodBody(
                uplink, "private void StopWarpFromHandle(double ut)");

            Assert.Contains("run(() => _actuator.SetWarp(0))", stop, StringComparison.Ordinal);
            Assert.Contains("WarpStopBudget.Record(", stop, StringComparison.Ordinal);

            var addon = CurrencyDelaySourceText.ReadRelative("GonogoAddon.cs");
            Assert.Contains(
                "engine.RunOnMainThreadAndWait(action)", addon, StringComparison.Ordinal);
            Assert.Contains(
                "ScetAlarmUplink.ConfigureMainThreadRunner(null)",
                CurrencyDelaySourceText.MethodBody(addon, "private void Shutdown()"),
                StringComparison.Ordinal);
        }

        /// <summary>
        /// One stop per alarm, however many threads decide. The tick carries ONE
        /// <c>StopWarp</c> flag for every pass, so the handle has to subtract what
        /// the capture already acted on or a single alarm commands the warp twice.
        /// </summary>
        [Fact]
        public void the_handle_does_not_repeat_the_captures_stop()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");
            var handle = CurrencyDelaySourceText.MethodBody(
                uplink, "private void HandleOnCourier(object? captured)");

            Assert.Contains(
                "tick.StopWarp && !publish.StoppedOnCapture", handle, StringComparison.Ordinal);
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
        /// The vantage check is installed and dropped the same way, because the
        /// engine's own predicate is private to it and a selectable-vantage
        /// question is not an Uplink author surface.
        /// </summary>
        [Fact]
        public void the_addon_installs_the_vantage_check_and_drops_it_again()
        {
            var addon = CurrencyDelaySourceText.ReadRelative("GonogoAddon.cs");

            Assert.Contains(
                "ScetAlarmUplink.ConfigureSelectableVantage(", addon, StringComparison.Ordinal);
            Assert.Contains("engine.IsVantageSelectable(", addon, StringComparison.Ordinal);

            var shutdown = CurrencyDelaySourceText.MethodBody(addon, "private void Shutdown()");
            Assert.Contains(
                "ScetAlarmUplink.ConfigureSelectableVantage(null)", shutdown, StringComparison.Ordinal);
        }

        /// <summary>
        /// An alarm's vantage is checked WHERE IT IS ASKED FOR and nowhere else.
        ///
        /// <para>The engine already rules this for a command's own vantage: an
        /// override is checked, a session's chosen vantage is not re-checked,
        /// because "re-checking it here would start refusing ordinary commands the
        /// moment the centre a session is sitting at went inactive". A crewed
        /// centre stops being one the moment its crew leaves, so a per-tick check
        /// would kill a standing alarm for a reason the operator never acted
        /// on.</para>
        /// </summary>
        [Fact]
        public void the_vantage_is_checked_at_arm_and_on_no_tick()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

            Assert.Contains(
                "ScetAlarmVantage.VerdictFor(",
                CurrencyDelaySourceText.MethodBody(
                    uplink, "private CommandResult HandleArm(ScetAlarmArmArgs? args, string vantage)"),
                StringComparison.Ordinal);

            foreach (var perTick in new[]
            {
                "private object? CaptureOnMain(KspSnapshot? snapshot)",
                "private void HandleOnCourier(object? captured)",
            })
            {
                Assert.DoesNotContain(
                    "_selectableVantage",
                    CurrencyDelaySourceText.MethodBody(uplink, perTick),
                    StringComparison.Ordinal);
            }
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
