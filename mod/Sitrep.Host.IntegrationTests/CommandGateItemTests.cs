using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A gate whose verdict depends on which item a call names publishes that
    /// verdict per item on <c>system.uplink.gates</c>, so a control for the one
    /// item that would be refused goes dark before it is pressed while the rest
    /// stay live.
    /// </summary>
    public class CommandGateItemTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task AnItemTheGateWouldRefuseIsPublishedWithItsVerdictAndAPassingItemIsNot()
        {
            var uplink = new ItemGateProbeUplink();
            var entry = await SampleOnce(uplink);

            var verdict = Assert.IsType<Dictionary<string, object?>>(entry["verdict"]);
            Assert.Equal((double)(int)GateOutcome.Abstain, verdict["outcome"]);
            Assert.Equal(ItemGateProbeUplink.Argument, entry["itemArgument"]);

            var items = Assert.IsType<List<object?>>(entry["items"]).Cast<Dictionary<string, object?>>().ToList();
            var dear = Assert.Single(items);
            Assert.Equal(ItemGateProbeUplink.DearItem, dear["value"]);
            var dearVerdict = Assert.IsType<Dictionary<string, object?>>(dear["verdict"]);
            Assert.Equal((double)(int)GateOutcome.Fail, dearVerdict["outcome"]);
            Assert.Equal(ItemGateProbeUplink.DearDetail, dearVerdict["detail"]);
        }

        /// <summary>
        /// A command refused for every item says so once, at command level, and
        /// asks no item at all: the per-item walk costs main-thread reads.
        /// </summary>
        [Fact]
        public async Task ACommandRefusedOutrightCarriesNoItems()
        {
            var uplink = new ItemGateProbeUplink { RefuseOutright = true };
            var entry = await SampleOnce(uplink);

            var verdict = Assert.IsType<Dictionary<string, object?>>(entry["verdict"]);
            Assert.Equal((double)(int)GateOutcome.Fail, verdict["outcome"]);
            Assert.Equal("", entry["itemArgument"]);
            Assert.Empty(Assert.IsType<List<object?>>(entry["items"]));
            Assert.Equal(0, uplink.ItemsAsked);
        }

        /// <summary>
        /// A static refusal declared after the per-item requirement still decides
        /// the command in advance. A career mod contributes "use my own command"
        /// behind core's per-item price, and the abstaining price must not hide it.
        /// </summary>
        [Fact]
        public async Task AStaticRefusalAfterAnItemRequirementStillDecidesTheCommand()
        {
            var uplink = new ItemGateProbeUplink { RefuseLast = true };
            var entry = await SampleOnce(uplink);

            var verdict = Assert.IsType<Dictionary<string, object?>>(entry["verdict"]);
            Assert.Equal((double)(int)GateOutcome.Fail, verdict["outcome"]);
            Assert.Empty(Assert.IsType<List<object?>>(entry["items"]));
        }

        [Fact]
        public void TwoItemArgumentsOnOneCommandRefuseTheirUplinkAndTheEngineStarts()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            var uplink = new ItemGateProbeUplink { SecondArgument = "otherId" };
            engine.RegisterUplink(uplink);
            engine.RegisterUplink(new HealthyUplink());
            engine.Start();
            try
            {
                var refused = engine.AvailabilityOf(uplink.Manifest.Id);
                Assert.False(refused.IsAvailable);
                Assert.Contains("names its items by both", refused.Reason);
                Assert.True(engine.AvailabilityOf(HealthyUplink.Id).IsAvailable);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A requirement an Uplink contributes to another's command that names
        /// a different item argument refuses the contributor and leaves the
        /// owner's gate working.
        /// </summary>
        [Fact]
        public async Task AContributedItemArgumentThatClashesRefusesTheContributorAlone()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(new ItemGateProbeUplink());
            engine.RegisterUplink(new ClashingContributorUplink());
            engine.Start();
            try
            {
                var refused = engine.AvailabilityOf(ClashingContributorUplink.Id);
                Assert.False(refused.IsAvailable);
                Assert.Contains("names its items by both", refused.Reason);
                Assert.True(engine.AvailabilityOf("item-gate-probe").IsAvailable);

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);
                engine.SampleCommandGates();
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
                var gate = Assert.Single(
                    Assert.IsType<List<object?>>(payload["gates"]).Cast<Dictionary<string, object?>>(),
                    g => (string?)g["command"] == ItemGateProbeUplink.Command);
                Assert.Equal(ItemGateProbeUplink.Argument, gate["itemArgument"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        private static async Task<Dictionary<string, object?>> SampleOnce(ItemGateProbeUplink uplink)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);

                engine.SampleCommandGates();
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
                var gates = Assert.IsType<List<object?>>(payload["gates"]);
                return Assert.Single(
                    gates.Cast<Dictionary<string, object?>>(),
                    g => (string?)g["command"] == ItemGateProbeUplink.Command);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class HealthyUplink : ISitrepUplink
        {
            public const string Id = "healthy";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest { Id = Id, Version = "1.0.0" };

            public void Register(IUplinkHost host)
            {
            }
        }

        private sealed class ClashingContributorUplink : ISitrepUplink
        {
            public const string Id = "clashing-contributor";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest { Id = Id, Version = "1.0.0" };

            public void Register(IUplinkHost host)
            {
                host.AddGateEvaluator(new Gate());
                host.AddCommandRequirement(
                    ItemGateProbeUplink.Command,
                    new CommandRequirement { Kind = Gate.GateKind, Needs = new[] { "shipName" } });
            }

            private sealed class Gate : ICommandGateEvaluator, ICommandGateItems
            {
                public const string GateKind = "clashing-vehicle";

                public string Kind => GateKind;

                public IEnumerable<string> Items(CommandRequirement requirement) => new[] { "V-1" };

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) => GateVerdict.Pass();
            }
        }

        private sealed class ItemGateProbeUplink : ISitrepUplink
        {
            public const string Command = "probe.item";
            public const string StaticKind = "probe-static";
            public const string PriceKind = "probe-price";
            public const string Argument = "itemId";
            public const string CheapItem = "cheap";
            public const string DearItem = "dear";
            public const string DearDetail = "the dear one costs more than the career holds";

            public bool RefuseOutright { get; set; }
            public bool RefuseLast { get; set; }
            public string? SecondArgument { get; set; }
            public int ItemsAsked { get; private set; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest
            {
                Id = "item-gate-probe",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = Command,
                        Delay = DelayRole.TrueNow,
                        Requires = Requirements(),
                    },
                },
            };

            private CommandRequirement[] Requirements()
            {
                var requires = new List<CommandRequirement>
                {
                    new CommandRequirement { Kind = StaticKind },
                    new CommandRequirement { Kind = PriceKind, Needs = new[] { Argument } },
                };
                if (RefuseLast)
                {
                    requires.Add(new CommandRequirement { Kind = StaticKind, Quantity = "last" });
                }
                if (SecondArgument != null)
                {
                    requires.Add(new CommandRequirement { Kind = PriceKind, Needs = new[] { SecondArgument } });
                }
                return requires.ToArray();
            }

            public void Register(IUplinkHost host)
            {
                host.AddGateEvaluator(new StaticGate(this));
                host.AddGateEvaluator(new PriceGate(this));
                host.AddCommandHandler<object?, CommandResult>(Command, _ => CommandResult.Ok());
            }

            private sealed class StaticGate : ICommandGateEvaluator
            {
                private readonly ItemGateProbeUplink _owner;

                public StaticGate(ItemGateProbeUplink owner) => _owner = owner;

                public string Kind => StaticKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
                    _owner.RefuseOutright || requirement.Quantity == "last"
                        ? GateVerdict.Fail("not in this save")
                        : GateVerdict.Pass();
            }

            private sealed class PriceGate : ICommandGateEvaluator, ICommandGateItems
            {
                private readonly ItemGateProbeUplink _owner;

                public PriceGate(ItemGateProbeUplink owner) => _owner = owner;

                public string Kind => PriceKind;

                public IEnumerable<string> Items(CommandRequirement requirement)
                {
                    _owner.ItemsAsked++;
                    return new[] { CheapItem, DearItem };
                }

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
                {
                    arguments.TryGet(Argument, out var item);
                    return (item as string) == DearItem
                        ? GateVerdict.Fail(CommandErrorCode.InsufficientFunds, DearDetail)
                        : GateVerdict.Pass();
                }
            }
        }
    }
}
