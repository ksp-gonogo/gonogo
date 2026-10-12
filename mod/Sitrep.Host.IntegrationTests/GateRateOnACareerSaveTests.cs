using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A watched gate report on the shape a career install with a comms mod
    /// has: many distinct argument-free requirements across its commands, and
    /// hundreds of items whose input (funds) moves on every frame. The windowed
    /// total of evaluations stays under the budget in every second, not just
    /// on average.
    /// </summary>
    public class GateRateOnACareerSaveTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private const int DistinctRequirements = 40;
        private const int Items = 450;
        private const double Frame = 1.0 / 60.0;

        [Fact]
        public async Task AWatchedReportStaysUnderTheBudgetWithManyRequirementsAndAnInputThatMovesEveryFrame()
        {
            var probe = new CareerProbeUplink(Items, DistinctRequirements);
            var log = new List<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(probe);
            engine.SetDiagnosticLog(msg => { lock (log) { log.Add(msg); } });
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);

                for (var frame = 0; frame < 60 * 20; frame++)
                {
                    probe.Funds = frame;
                    engine.SampleCommandGatesAt(frame * Frame);
                }

                lock (log)
                {
                    Assert.DoesNotContain(log, line => line.Contains("[perf-budget]"));
                }
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class CareerProbeUplink : ISitrepUplink
        {
            private const string StaticCommand = "probe.static";
            private const string ItemCommand = "probe.item";
            private const string StaticKind = "probe-static";
            private const string ItemKind = "probe-item";
            private const string Argument = "itemId";

            private readonly int _items;
            private readonly int _requirements;
            private int _funds;

            public CareerProbeUplink(int items, int requirements)
            {
                _items = items;
                _requirements = requirements;
            }

            public int Funds
            {
                get => Volatile.Read(ref _funds);
                set => Volatile.Write(ref _funds, value);
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest
            {
                Id = "career-probe",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = StaticCommand,
                        Delay = DelayRole.TrueNow,
                        Requires = Enumerable.Range(0, _requirements)
                            .Select(i => new CommandRequirement { Kind = StaticKind, Facility = "f" + i.ToString("D2") })
                            .ToArray(),
                    },
                    new CommandDeclaration
                    {
                        Command = ItemCommand,
                        Delay = DelayRole.TrueNow,
                        Requires = new[] { new CommandRequirement { Kind = ItemKind, Needs = new[] { Argument } } },
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddGateEvaluator(new StaticGate());
                host.AddGateEvaluator(new ItemGate(this));
                host.AddCommandHandler<object?, CommandResult>(StaticCommand, _ => CommandResult.Ok());
                host.AddCommandHandler<object?, CommandResult>(ItemCommand, _ => CommandResult.Ok());
            }

            private sealed class StaticGate : ICommandGateEvaluator
            {
                public string Kind => StaticKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) => GateVerdict.Pass();
            }

            private sealed class ItemGate : ICommandGateEvaluator, ICommandGateItems, ICommandGateInputs
            {
                private readonly CareerProbeUplink _owner;

                public ItemGate(CareerProbeUplink owner) => _owner = owner;

                public string Kind => ItemKind;

                public IReadOnlyList<GateInput> Inputs =>
                    new[] { new GateInput("funds", () => _owner.Funds) };

                public IEnumerable<string> Items(CommandRequirement requirement) =>
                    Enumerable.Range(0, _owner._items).Select(i => "item-" + i.ToString("D4")).ToList();

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) => GateVerdict.Pass();
            }
        }
    }
}
