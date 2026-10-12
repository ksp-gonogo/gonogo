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
    /// The gate sampler's cost follows what is being watched, not what the save
    /// contains. A career install with a comms mod has a ground station per
    /// site, a strategy per leader and a tech node per research, and every one
    /// of those once cost an evaluator call twice a second from the moment the
    /// Space Center loaded, with nobody connected.
    /// </summary>
    public class GateSamplingDemandTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private const int Stations = 31;
        private const int Items = 450;

        [Fact]
        public void NoOneWatchingTheGatesMeansNoEvaluatorIsAsked()
        {
            var probe = new ScaleProbeUplink(Items);
            using var engine = StartEngine(probe);
            try
            {
                for (var pass = 0; pass < 10; pass++)
                {
                    engine.SampleCommandGatesAt(pass * ChannelEngine.GateSampleIntervalSec);
                }

                Assert.Equal(0, probe.Evaluations);
                Assert.Equal(0, probe.ItemsAsked);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task AWatchedReportStaysUnderTheBudgetWhateverTheSaveHolds()
        {
            var probe = new ScaleProbeUplink(Items);
            var log = new List<string>();
            using var engine = StartEngine(probe);
            engine.SetDiagnosticLog(msg => { lock (log) { log.Add(msg); } });
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);

                var passes = (int)Math.Ceiling(2.0 / ChannelEngine.GateSampleIntervalSec);
                for (var pass = 0; pass < passes; pass++)
                {
                    engine.SampleCommandGatesAt(pass * ChannelEngine.GateSampleIntervalSec);
                }

                Assert.True(
                    probe.Evaluations <= ChannelEngine.GateEvaluationBudget * 2.0,
                    $"{probe.Evaluations} evaluator calls in two seconds against a budget of {ChannelEngine.GateEvaluationBudget} a second");
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

        [Fact]
        public async Task EveryItemIsStillReachedAndTheDearOneDeepInTheListIsPublished()
        {
            var probe = new ScaleProbeUplink(Items);
            using var engine = StartEngine(probe);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);

                for (var pass = 0; pass < Items; pass++)
                {
                    engine.SampleCommandGatesAt(pass * ChannelEngine.GateSampleIntervalSec);
                }
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
                var gate = Assert.Single(
                    Assert.IsType<List<object?>>(payload["gates"]).Cast<Dictionary<string, object?>>(),
                    g => (string?)g["command"] == ScaleProbeUplink.Command);
                var dear = Assert.Single(Assert.IsType<List<object?>>(gate["items"]).Cast<Dictionary<string, object?>>());
                Assert.Equal(ScaleProbeUplink.DearItem(Items), dear["value"]);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASubscriberWhoArrivesLateGetsTheNextFrameSampledAtOnce()
        {
            var probe = new ScaleProbeUplink(2);
            using var engine = StartEngine(probe);
            try
            {
                engine.SampleCommandGatesAt(0.0);
                Assert.Equal(0, probe.Evaluations);

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);

                engine.SampleCommandGatesAt(0.01);
                Assert.True(probe.Evaluations > 0, "a watcher waited out the throttle for its first verdicts");
            }
            finally
            {
                engine.Stop();
            }
        }

        private static ChannelEngine StartEngine(ScaleProbeUplink probe)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterCommandCentreSource(new StationNetwork(Stations));
            engine.RegisterUplink(probe);
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            return engine;
        }

        private sealed class StationNetwork : ICommandCentreSource
        {
            private readonly List<ICommandCentre> _stations;

            public StationNetwork(int count) =>
                _stations = Enumerable.Range(0, count).Select(i => (ICommandCentre)new Station(i)).ToList();

            public string ProviderId => "station-network";

            public IEnumerable<ICommandCentre> Enumerate() => _stations;

            private sealed class Station : ICommandCentre
            {
                public Station(int index) => Id = "ground:Station " + index.ToString("D2");

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind => CommandCentreKind.GroundStation;
                public int? BodyIndex => null;
                public double? Latitude => null;
                public double? Longitude => null;
                public bool IsActiveNow() => true;
            }
        }

        private sealed class ScaleProbeUplink : ISitrepUplink
        {
            public const string Command = "probe.scale";
            private const string Kind = "probe-scale";
            private const string Argument = "itemId";

            private readonly int _items;
            private int _evaluations;
            private int _itemsAsked;

            public ScaleProbeUplink(int items) => _items = items;

            public int Evaluations => Volatile.Read(ref _evaluations);
            public int ItemsAsked => Volatile.Read(ref _itemsAsked);

            public static string DearItem(int items) => "item-" + (items - 1).ToString("D4");

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest
            {
                Id = "scale-probe",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = Command,
                        Delay = DelayRole.TrueNow,
                        Requires = new[] { new CommandRequirement { Kind = Kind, Needs = new[] { Argument } } },
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddGateEvaluator(new Gate(this));
                host.AddCommandHandler<object?, CommandResult>(Command, _ => CommandResult.Ok());
            }

            private sealed class Gate : ICommandGateEvaluator, ICommandGateItems
            {
                private readonly ScaleProbeUplink _owner;

                public Gate(ScaleProbeUplink owner) => _owner = owner;

                public string Kind => ScaleProbeUplink.Kind;

                public IEnumerable<string> Items(CommandRequirement requirement)
                {
                    Interlocked.Increment(ref _owner._itemsAsked);
                    return Enumerable.Range(0, _owner._items).Select(i => "item-" + i.ToString("D4")).ToList();
                }

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
                {
                    Interlocked.Increment(ref _owner._evaluations);
                    arguments.TryGet(Argument, out var item);
                    return (item as string) == DearItem(_owner._items)
                        ? GateVerdict.Fail(CommandErrorCode.InsufficientFunds, "dear")
                        : GateVerdict.Pass();
                }
            }
        }
    }
}
