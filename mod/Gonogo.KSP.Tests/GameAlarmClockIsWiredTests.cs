using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// That the alarm uplink reaches the game's alarm clock through the
    /// capability, publishes it on the two Topics, and keeps the copies in step
    /// with the roster.
    ///
    /// <para>Source text, for the reason <c>ScetShadowAudienceIsWiredTests</c>
    /// gives: <c>ScetAlarmUplink</c> needs a live scene. The decisions are tested
    /// headlessly in <c>Sitrep.Host.Tests.GameAlarmTests</c>.</para>
    /// </summary>
    public class GameAlarmClockIsWiredTests
    {
        private static string Uplink() => CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

        [Fact]
        public void the_stock_clock_is_the_vanilla_of_an_exclusive_capability()
        {
            var declare = CurrencyDelaySourceText.MethodBody(Uplink(), "public void DeclareCapabilities(Kernel kernel)");

            Assert.Contains("Id = GameAlarmClockCapability.Id", declare, StringComparison.Ordinal);
            Assert.Contains("Vanilla = _ => new StockAlarmClockBackend()", declare, StringComparison.Ordinal);
        }

        [Fact]
        public void the_capture_that_syncs_the_clock_is_ungated_so_no_subscription_can_starve_it()
        {
            var register = CurrencyDelaySourceText.MethodBody(Uplink(), "public void Register(IUplinkHost host)");

            Assert.Contains("host.AddSampledSource(CaptureOnMain, HandleOnCourier);", register, StringComparison.Ordinal);
        }

        [Fact]
        public void the_clock_is_read_through_the_kernel_and_never_named_directly()
        {
            var uplink = Uplink();

            Assert.Contains("_kernel.Query<IGameAlarmClock>(GameAlarmClockCapability.Id)", uplink, StringComparison.Ordinal);
            Assert.DoesNotContain("AlarmClockScenario", uplink, StringComparison.Ordinal);
        }

        [Fact]
        public void craft_alarms_go_through_the_per_craft_namespace_and_the_rest_on_the_shared_list()
        {
            var uplink = Uplink();
            var register = CurrencyDelaySourceText.MethodBody(uplink, "public void Register(IUplinkHost host)");
            Assert.Contains(
                "host.RegisterDynamicNamespace(GameAlarmBoard.CraftPrefix, GameAlarmBoard.CraftNamespace())",
                register,
                StringComparison.Ordinal);
            Assert.Contains("GameAlarmBoard.ListChannel()", uplink, StringComparison.Ordinal);

            var publish = CurrencyDelaySourceText.MethodBody(uplink, "private void PublishGameAlarms(ScetAlarmPublish publish)");
            Assert.Contains("_gameCraftSource?.Publisher(craft.Key + GameAlarmBoard.CraftSuffix)", publish, StringComparison.Ordinal);
        }

        [Fact]
        public void the_clock_is_synced_after_the_tick_opens_so_a_rewind_clears_first()
        {
            var capture = CurrencyDelaySourceText.MethodBody(Uplink(), "private object? CaptureOnMain(KspSnapshot? snapshot)");

            var opens = capture.IndexOf("_roster.BeginTick(ut)", StringComparison.Ordinal);
            var syncs = capture.IndexOf("SyncGameClock(ut)", StringComparison.Ordinal);
            Assert.True(opens >= 0 && syncs > opens);
        }

        [Fact]
        public void a_disarm_takes_the_copy_and_an_alarm_deleted_in_the_game_is_refused()
        {
            var uplink = Uplink();

            var disarm = CurrencyDelaySourceText.MethodBody(uplink, "private CommandResult HandleDisarm(ScetAlarmDisarmArgs? args)");
            Assert.Contains("_mirror.Disarmed(args.Id)", disarm, StringComparison.Ordinal);

            var arm = CurrencyDelaySourceText.MethodBody(uplink, "private CommandResult HandleArm(ScetAlarmArmArgs? args, string vantage)");
            Assert.Contains("_roster.IsDeletedInGame(args.Id)", arm, StringComparison.Ordinal);
        }

        [Fact]
        public void a_game_alarm_deleted_from_gonogo_deletes_the_gonogo_alarm_it_copies()
        {
            var sync = CurrencyDelaySourceText.MethodBody(Uplink(), "private GameAlarmPublishes? SyncGameClock(double ut)");

            Assert.Contains("clock.Delete(id)", sync, StringComparison.Ordinal);
            Assert.Contains("_mirror.ForgetGameAlarm(id)", sync, StringComparison.Ordinal);
            Assert.Contains("_roster.MarkDeletedInGame(gonogoId)", sync, StringComparison.Ordinal);
        }

        [Fact]
        public void the_copy_leaves_time_warp_to_gonogo()
        {
            var backend = CurrencyDelaySourceText.ReadRelative("StockAlarmClockBackend.cs");
            var create = CurrencyDelaySourceText.MethodBody(backend, "public long? CreateAtUt(string title, double ut)");

            Assert.Contains("AlarmActions.WarpEnum.DoNothing", create, StringComparison.Ordinal);
        }
    }
}
