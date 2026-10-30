using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command is accepted with the one-way delay it is then held for, whether
    /// its subject is a lens standing on a craft or the active craft, and a plan
    /// that reckons the path longer or shorter than the ledger does not change it.
    /// </summary>
    public class AcceptedDelayMatchesHoldTests
    {
        private const string Commander = "ground:KSC";
        private const string Craft = "abc";
        private const double CraftDelay = 15.0;

        [Fact]
        public void ALensOnACraftIsAcceptedWithTheDelayItIsHeldFor()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new LensCommandUplink());
            engine.Start();
            try
            {
                engine.SetAuthorityDelays(new[] { (Commander, Craft, CraftDelay) });
                Tick(engine, 0.0);

                double? accepted = null;
                var answered = false;
                engine.DispatchCommandAndWait(LensCommandUplink.Command, "x", Commander, _ => answered = true, TestBudgets.Op, onAccepted: s => accepted = s);

                Assert.NotNull(accepted);
                Assert.Equal(CraftDelay, accepted!.Value, 6);
                Tick(engine, CraftDelay - 1.0);
                Assert.False(answered);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ACommandOnAPlannedRouteIsAcceptedWithTheLedgerDelayItRunsAfter()
        {
            var world = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame { ActiveSeconds = CraftDelay });
            await using var _ = world;
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0, 1000.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            double? accepted = null;
            world.Engine.DispatchCommandAndWait(ScriptedContactUplink.ActiveCommand, "x", ScriptedContactGame.Home, _ => { }, TestBudgets.Op, onAccepted: s => accepted = s);
            var pending = Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending.Single();

            Assert.NotNull(accepted);
            Assert.Equal(CraftDelay, accepted!.Value, 6);
            Assert.Equal(1000.0 + CraftDelay, pending.PredictedArrivalUt!.Value, 6);
            Assert.Equal(1000.0 + 2 * CraftDelay, pending.PredictedReplyUt!.Value, 6);

            world.Tick(1000.0 + 2 * CraftDelay - 1.0);
            Assert.DoesNotContain(world.Engine.JourneyAt(ScriptedContactGame.Home).Events, e => e.Kind == JourneyEventKind.Ran);
            world.Tick(1000.0 + 2 * CraftDelay + 1.0);
            Assert.Contains(world.Engine.JourneyAt(ScriptedContactGame.Home).Events, e => e.Kind == JourneyEventKind.Ran);
        }

        private static void Tick(ChannelEngine engine, double ut) =>
            engine.TickAndWait(ut, new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?>() }, TestBudgets.Op);

        private sealed class LensCommandUplink : ISitrepUplink
        {
            public const string Command = "lens.probe.act";

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "lens-command-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = "lens.probe.state" },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.RegisterDynamicNamespace("lens.", new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    PerLensNode = true,
                    LensSiteForKey = key => key == "probe" ? "vessel:" + Craft : null,
                });
                host.AddCommandHandler<string, string>(Command, args => "done:" + args);
            }
        }
    }
}
