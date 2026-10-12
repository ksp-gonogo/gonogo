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
    /// An item whose evaluator declares its inputs is asked again when one of
    /// them moves, in the frame it moves, and at no other time: not on a timer,
    /// not for an item whose evaluator reads something else, and not at all
    /// while nobody watches the report.
    /// </summary>
    public class GateItemInputTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private const int FundsItems = 6;
        private const int ScienceItems = 4;
        private const double Frame = 1.0 / 60.0;

        [Fact]
        public async Task AChangeInFundsAsksOnlyTheItemsWhoseEvaluatorReadsFunds()
        {
            var probe = new InputProbeUplink(FundsItems, ScienceItems);
            using var engine = StartEngine(probe);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);
                engine.SampleCommandGatesAt(0.0);
                Assert.Equal(FundsItems, probe.Asked(InputProbeUplink.FundsKind));
                Assert.Equal(ScienceItems, probe.Asked(InputProbeUplink.ScienceKind));
                probe.ResetCounts();

                probe.Funds = 50;
                engine.SampleCommandGatesAt(Frame);

                Assert.Equal(FundsItems, probe.Asked(InputProbeUplink.FundsKind));
                Assert.Equal(0, probe.Asked(InputProbeUplink.ScienceKind));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AChangeInAnInputNobodyReadsAsksNothing()
        {
            var probe = new InputProbeUplink(FundsItems, ScienceItems);
            using var engine = StartEngine(probe);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);
                engine.SampleCommandGatesAt(0.0);
                probe.ResetCounts();

                probe.Unrelated = 7;
                engine.SampleCommandGatesAt(Frame);

                Assert.Equal(0, probe.Asked(InputProbeUplink.FundsKind));
                Assert.Equal(0, probe.Asked(InputProbeUplink.ScienceKind));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task NothingChangingMeansNothingIsAskedHoweverLongTheReportIsWatched()
        {
            var probe = new InputProbeUplink(FundsItems, ScienceItems);
            using var engine = StartEngine(probe);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);
                engine.SampleCommandGatesAt(0.0);
                probe.ResetCounts();

                for (var frame = 1; frame <= 600; frame++)
                {
                    engine.SampleCommandGatesAt(frame * Frame);
                }

                Assert.Equal(0, probe.Asked(InputProbeUplink.FundsKind));
                Assert.Equal(0, probe.Asked(InputProbeUplink.ScienceKind));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AShownItemIsFreshInTheFrameItsInputMoves()
        {
            var probe = new InputProbeUplink(FundsItems, ScienceItems);
            using var engine = StartEngine(probe);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);
                engine.SampleCommandGatesAt(0.0);
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);
                var before = await ReceiveStreamDataAsync(client, Timeout);
                Assert.Empty(ItemsOf(before.Payload, InputProbeUplink.FundsCommand));

                probe.Funds = 10;
                engine.SampleCommandGatesAt(Frame);
                engine.TickAndWait(2.0, new KspSnapshot { Ut = 2.0 }, Timeout);
                var after = await ReceiveStreamDataAsync(client, Timeout);

                var refused = ItemsOf(after.Payload, InputProbeUplink.FundsCommand);
                Assert.Equal(FundsItems, refused.Count);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void NoOneWatchingMeansNeitherAnItemNorAnInputIsRead()
        {
            var probe = new InputProbeUplink(FundsItems, ScienceItems);
            using var engine = StartEngine(probe);
            try
            {
                for (var frame = 0; frame < 120; frame++)
                {
                    probe.Funds = frame;
                    engine.SampleCommandGatesAt(frame * Frame);
                }

                Assert.Equal(0, probe.Asked(InputProbeUplink.FundsKind));
                Assert.Equal(0, probe.Asked(InputProbeUplink.ScienceKind));
                Assert.Equal(0, probe.InputReads);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AnItemNamedForTheFirstTimeIsAskedInThatFrame()
        {
            var probe = new InputProbeUplink(FundsItems, ScienceItems);
            using var engine = StartEngine(probe);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);
                engine.SampleCommandGatesAt(0.0);
                probe.ResetCounts();

                probe.Science = 3;
                probe.ScienceItemCount = ScienceItems + 2;
                engine.SampleCommandGatesAt(Frame);

                Assert.Equal(ScienceItems + 2, probe.Asked(InputProbeUplink.ScienceKind));
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AChangeTouchingMoreItemsThanTheAllowanceHoldsDrainsInOrderAndStaysUnderTheBudget()
        {
            const int Many = 450;
            var probe = new InputProbeUplink(Many, 0);
            var log = new List<string>();
            using var engine = StartEngine(probe);
            engine.SetDiagnosticLog(msg => { lock (log) { log.Add(msg); } });
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);

                var window = new Queue<int>();
                var windowSum = 0;
                var peak = 0;
                var previous = 0;
                for (var frame = 0; frame < 60 * 20 && previous < Many; frame++)
                {
                    engine.SampleCommandGatesAt(frame * Frame);
                    var asked = probe.Asked(InputProbeUplink.FundsKind);
                    window.Enqueue(asked - previous);
                    windowSum += asked - previous;
                    previous = asked;
                    if (window.Count > 60) windowSum -= window.Dequeue();
                    peak = Math.Max(peak, windowSum);
                }

                Assert.Equal(Many, previous);
                Assert.True(
                    peak <= ChannelEngine.GateEvaluationBudget,
                    $"{peak} item evaluations in one second against a budget of {ChannelEngine.GateEvaluationBudget}");
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

        private static List<Dictionary<string, object?>> ItemsOf(object? payload, string command)
        {
            var report = Assert.IsType<Dictionary<string, object?>>(payload);
            var gate = Assert.Single(
                Assert.IsType<List<object?>>(report["gates"]).Cast<Dictionary<string, object?>>(),
                g => (string?)g["command"] == command);
            return Assert.IsType<List<object?>>(gate["items"]).Cast<Dictionary<string, object?>>().ToList();
        }

        private static ChannelEngine StartEngine(InputProbeUplink probe)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(probe);
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            return engine;
        }

        private sealed class InputProbeUplink : ISitrepUplink
        {
            public const string FundsCommand = "probe.funds";
            public const string ScienceCommand = "probe.science";
            public const string FundsKind = "probe-funds";
            public const string ScienceKind = "probe-science";
            private const string Argument = "itemId";

            private readonly int _fundsItems;
            private int _scienceItems;
            private readonly Dictionary<string, int> _asked = new Dictionary<string, int>();
            private int _inputReads;
            private int _funds = 1000;
            private int _science = 1000;
            private int _unrelated;

            public InputProbeUplink(int fundsItems, int scienceItems)
            {
                _fundsItems = fundsItems;
                _scienceItems = scienceItems;
            }

            public int Funds { set => Volatile.Write(ref _funds, value); }
            public int Science { set => Volatile.Write(ref _science, value); }
            public int Unrelated { set => Volatile.Write(ref _unrelated, value); }
            public int ScienceItemCount { set => Volatile.Write(ref _scienceItems, value); }
            public int InputReads => Volatile.Read(ref _inputReads);

            public int Asked(string kind)
            {
                lock (_asked) { return _asked.TryGetValue(kind, out var n) ? n : 0; }
            }

            public void ResetCounts()
            {
                lock (_asked) { _asked.Clear(); }
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest
            {
                Id = "input-probe",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    Declare(FundsCommand, FundsKind),
                    Declare(ScienceCommand, ScienceKind),
                },
            };

            private static CommandDeclaration Declare(string command, string kind) => new CommandDeclaration
            {
                Command = command,
                Delay = DelayRole.TrueNow,
                Requires = new[] { new CommandRequirement { Kind = kind, Needs = new[] { Argument } } },
            };

            public void Register(IUplinkHost host)
            {
                var funds = new GateInput("funds", () => { Interlocked.Increment(ref _inputReads); return Volatile.Read(ref _funds); });
                var science = new GateInput("science", () => { Interlocked.Increment(ref _inputReads); return Volatile.Read(ref _science); });
                host.AddGateEvaluator(new Gate(this, FundsKind, funds, () => _fundsItems, () => Volatile.Read(ref _funds)));
                host.AddGateEvaluator(new Gate(this, ScienceKind, science, () => Volatile.Read(ref _scienceItems), () => Volatile.Read(ref _science)));
                host.AddCommandHandler<object?, CommandResult>(FundsCommand, _ => CommandResult.Ok());
                host.AddCommandHandler<object?, CommandResult>(ScienceCommand, _ => CommandResult.Ok());
            }

            private sealed class Gate : ICommandGateEvaluator, ICommandGateItems, ICommandGateInputs
            {
                private readonly InputProbeUplink _owner;
                private readonly Func<int> _count;
                private readonly Func<int> _balance;

                public Gate(InputProbeUplink owner, string kind, GateInput input, Func<int> count, Func<int> balance)
                {
                    _owner = owner;
                    Kind = kind;
                    Inputs = new[] { input };
                    _count = count;
                    _balance = balance;
                }

                public string Kind { get; }

                public IReadOnlyList<GateInput> Inputs { get; }

                public IEnumerable<string> Items(CommandRequirement requirement) =>
                    Enumerable.Range(0, _count()).Select(i => "item-" + i.ToString("D4")).ToList();

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
                {
                    lock (_owner._asked)
                    {
                        _owner._asked[Kind] = (_owner._asked.TryGetValue(Kind, out var n) ? n : 0) + 1;
                    }
                    return _balance() < 100
                        ? GateVerdict.Fail(CommandErrorCode.InsufficientFunds, "short")
                        : GateVerdict.Pass();
                }
            }
        }
    }
}
