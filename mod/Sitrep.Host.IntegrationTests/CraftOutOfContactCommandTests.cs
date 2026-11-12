using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A craft whose link is down, from a signal cut or, when the save asks for
    /// it, from running out of charge. A command a centre sends it never runs,
    /// while the crew aboard still command their own craft at once.
    /// </summary>
    public class CraftOutOfContactCommandTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        /// <summary>
        /// The craft stays dark past the moment the centre's plan had the command
        /// arriving. The command waits with the centre for a contact and never runs
        /// while the craft is dark.
        /// </summary>
        [Fact]
        public async Task ACommandFromACentreNeverRunsOnTheDarkCraft()
        {
            await using var world = await ReckonedVantageWorld.StartAsync(new ScriptedContactGame { ActiveSeconds = 4.0 });
            foreach (var ut in new[] { 1.0, 2.0, 700.0, 702.0, 1000.0 })
            {
                world.Tick(ut);
            }
            world.Game.ActiveConnected = false;
            world.Tick(1002.0);
            await world.SettleAsync();

            world.Engine.DispatchCommandAndWait(ScriptedContactUplink.ActiveCommand, "x", ScriptedContactGame.Home, _ => { }, TestBudgets.Op);
            foreach (var ut in new[] { 1010.0, 1020.0, 1060.0, 2000.0, 2200.0, 2400.0, 3400.0 })
            {
                world.Tick(ut);
            }
            await world.SettleAsync();

            // Past its first predicted reply, with the hop to the dark craft lost and the
            // command still with the centre that sent it: never a late reply.
            var pending = Assert.IsType<PendingUplinkQueue>(world.Engine.PayloadOf(ChannelEngine.UplinkPendingTopic)).Pending.Single();
            Assert.Null(pending.ReplyOverdueUt);
            // Nor does the entry give a client a reply time already behind it: it is either held, or due later.
            Assert.True(pending.PredictedHeldAt != null || pending.PredictedReplyUt > 3400.0, $"held at {pending.PredictedHeldAt}, reply {pending.PredictedReplyUt}");
            Assert.Equal(0, world.Uplink.ActiveHandledCount);
        }

        [Fact]
        public void ACommandFromTheCrewedCraftsOwnSeatRunsWithItsLinkDown()
        {
            var stage = new StageUplink();
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterDiscoveredUplinks(new List<UplinkDiscovery.DiscoveredUplink>
            {
                new UplinkDiscovery.DiscoveredUplink(new CommNetDisabledTestUplink(modelPresent: true), ContractVersion.Major, ContractVersion.Minor),
                new UplinkDiscovery.DiscoveredUplink(stage, ContractVersion.Major, ContractVersion.Minor),
            });
            engine.ResolveCapabilities();
            engine.RegisterCommandCentreSource(new SeatSource());
            engine.Start();
            try
            {
                for (var ut = 0.0; ut <= 3.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, Snapshot(ut), Timeout);
                }

                CommandResult? answer = null;
                engine.DispatchCommandAndWait(StageUplink.Command, "x", Seat, r => answer = r as CommandResult, Timeout);
                engine.TickAndWait(4.0, Snapshot(4.0), Timeout);

                Assert.True(stage.HandledCount == 1, $"the seat's command was answered {answer?.ErrorCode} {answer?.Detail}");
            }
            finally
            {
                engine.Stop();
            }
        }

        private const string Craft = "seat1";
        private const string Seat = "vessel:" + Craft;

        private static KspSnapshot Snapshot(double ut) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["reading"] = 100.0 + ut,
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = Craft },
                },
            },
        };

        private sealed class StageUplink : ISitrepUplink
        {
            public const string Command = "power.stage";
            public const string Topic = "power.subject";
            private int _handled;

            public int HandledCount => Volatile.Read(ref _handled);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "power-stage-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    },
                },
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.Delayed, Subject = Topic },
                },
            };

            public void Register(IUplinkHost host) =>
                host.AddCommandHandler<string, string>(Command, args =>
                {
                    Interlocked.Increment(ref _handled);
                    return "staged";
                });
        }

        private sealed class SeatSource : ICommandCentreSource
        {
            public string ProviderId => "seat-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return new Centre();
            }

            private sealed class Centre : ICommandCentre
            {
                public string Id => Seat;
                public string DisplayName => "Seat";
                public CommandCentreKind Kind => CommandCentreKind.CrewedVessel;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
