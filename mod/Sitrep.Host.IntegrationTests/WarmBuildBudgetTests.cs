using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A Delayed topic nobody reads is still built now and then, so a client
    /// joining later is handed a current sample. The unsubscribed-topic warm build
    /// budget prices those builds per UT second, and a stopped clock must not
    /// read as a burst: the window it sums over never moves.
    /// </summary>
    public class WarmBuildBudgetTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private const int Topics = 100;
        private const double StartUt = 666.137;

        [Fact]
        public void AStoppedClockDoesNotReadAsABurstOfWarmBuilds()
        {
            var log = Run(ticks: 12, utAt: _ => StartUt);

            Assert.DoesNotContain(log, line => line.Contains("[perf-budget]"));
        }

        [Fact]
        public void ARunningClockStaysWithinTheWarmBuildBudget()
        {
            var log = Run(ticks: 600, utAt: tick => StartUt + tick * 0.1);

            Assert.DoesNotContain(log, line => line.Contains("[perf-budget]"));
        }

        private static List<string> Run(int ticks, Func<int, double> utAt)
        {
            var log = new List<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 1.0);
            engine.RegisterUplink(new ManyDelayedTopicsUplink());
            engine.SetDiagnosticLog(msg => { lock (log) { log.Add(msg); } });
            engine.Start();
            try
            {
                for (var tick = 0; tick < ticks; tick++)
                {
                    var ut = utAt(tick);
                    engine.TickAndWait(ut, new KspSnapshot
                    {
                        Ut = ut,
                        Values = new Dictionary<string, object?> { ["scene"] = "Flight" },
                    }, Timeout);
                }
            }
            finally
            {
                engine.Stop();
            }
            lock (log)
            {
                return log.ToList();
            }
        }

        private sealed class ManyDelayedTopicsUplink : ISitrepUplink
        {
            private static readonly string[] Names =
                Enumerable.Range(0, Topics).Select(i => "warmbudget.topic" + i).ToArray();

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "warm-budget-test",
                Version = "1.0.0",
                Channels = Names.Select(name => new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Topic = name,
                    Requires = Requirement.None,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                }).ToList(),
            };

            public void Register(IUplinkHost host)
            {
                foreach (var name in Names)
                {
                    host.AddChannelSource(name, snapshot => snapshot?.Values["scene"]);
                }
            }
        }
    }
}
