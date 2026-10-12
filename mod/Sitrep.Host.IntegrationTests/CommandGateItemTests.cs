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
            var set = Assert.Single(Sets(entry));
            Assert.Equal(ItemGateProbeUplink.Argument, set["argument"]);

            var items = Items(set);
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
            Assert.Empty(Sets(entry));
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
            Assert.Empty(Sets(entry));
        }

        /// <summary>
        /// A launch is a site and a vehicle: two arguments of one command, each
        /// with its own verdicts. Both sets are published, and each refuses only
        /// the item its own requirement refuses.
        /// </summary>
        [Fact]
        public async Task TwoItemArgumentsOnOneCommandArePublishedAsTwoSets()
        {
            var uplink = new ItemGateProbeUplink { SecondArgument = ItemGateProbeUplink.SecondArgumentName };
            var entry = await SampleOnce(uplink);

            var sets = Sets(entry).ToDictionary(s => (string)s["argument"]!);
            Assert.Equal(2, sets.Count);
            var first = Assert.Single(Items(sets[ItemGateProbeUplink.Argument]));
            Assert.Equal(ItemGateProbeUplink.DearItem, first["value"]);
            var second = Assert.Single(Items(sets[ItemGateProbeUplink.SecondArgumentName]));
            Assert.Equal(ItemGateProbeUplink.SecondDearItem, second["value"]);
        }

        /// <summary>
        /// A requirement an Uplink contributes that nothing can evaluate refuses
        /// that Uplink with a reason an operator can read, and the engine starts
        /// with everything else.
        /// </summary>
        [Fact]
        public async Task AnUplinkContributingAnUnevaluableRequirementIsRefusedAloneAndTheEngineStarts()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(new ItemGateProbeUplink());
            engine.RegisterUplink(new ClashingContributorUplink());
            engine.Start();
            try
            {
                var refused = engine.AvailabilityOf(ClashingContributorUplink.Id);
                Assert.False(refused.IsAvailable);
                Assert.Contains("no-such-kind", refused.Reason);
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
                Assert.Single(Sets(gate));
            }
            finally
            {
                engine.Stop();
            }
        }

        private static List<Dictionary<string, object?>> Sets(Dictionary<string, object?> entry) =>
            Assert.IsType<List<object?>>(entry["itemSets"]).Cast<Dictionary<string, object?>>().ToList();

        private static List<Dictionary<string, object?>> Items(Dictionary<string, object?> set) =>
            Assert.IsType<List<object?>>(set["items"]).Cast<Dictionary<string, object?>>().ToList();

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

        private sealed class ClashingContributorUplink : ISitrepUplink
        {
            public const string Id = "clashing-contributor";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest { Id = Id, Version = "1.0.0" };

            public void Register(IUplinkHost host) =>
                host.AddCommandRequirement(
                    ItemGateProbeUplink.Command,
                    new CommandRequirement { Kind = "no-such-kind", Needs = new[] { "shipName" } });
        }

        private sealed class ItemGateProbeUplink : ISitrepUplink
        {
            public const string Command = "probe.item";
            public const string StaticKind = "probe-static";
            public const string PriceKind = "probe-price";
            public const string Argument = "itemId";
            public const string CheapItem = "cheap";
            public const string DearItem = "dear";
            public const string SecondArgumentName = "otherId";
            public const string SecondDearItem = "south";
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
                    return requirement.Needs![0] == SecondArgumentName
                        ? new[] { "north", SecondDearItem }
                        : new[] { CheapItem, DearItem };
                }

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
                {
                    var argument = requirement.Needs![0];
                    arguments.TryGet(argument, out var item);
                    var dear = argument == SecondArgumentName ? SecondDearItem : DearItem;
                    return (item as string) == dear
                        ? GateVerdict.Fail(CommandErrorCode.InsufficientFunds, DearDetail)
                        : GateVerdict.Pass();
                }
            }
        }
    }
}
