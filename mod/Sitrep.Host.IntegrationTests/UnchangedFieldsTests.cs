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
    /// A field sent only on change leaves the frame while it holds what the
    /// connection was last sent, and a client that keeps it from the last frame
    /// that carried it always holds the value the mod published.
    /// </summary>
    public class UnchangedFieldsTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public async Task AClientKeepingLeftOutFieldsAlwaysHoldsThePublishedGrid()
        {
            var probe = new GridProbeUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SendFieldsOnChange(GridProbeUplink.Topic, new[] { "grid" });
            engine.RegisterUplink(probe);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, GridProbeUplink.Topic, Timeout);

                for (var tick = 1; tick <= 40; tick++)
                {
                    if (tick == 20)
                    {
                        probe.Retake();
                    }
                    engine.TickAndWait(tick, GridProbeUplink.Snapshot(), Timeout);
                }
                var frames = await DrainAllStreamDataAsync(client, TestBudgets.Quiet);

                Assert.NotEmpty(frames);
                object? held = null;
                var leftOut = 0;
                foreach (var frame in frames)
                {
                    var payload = Assert.IsType<Dictionary<string, object?>>(frame.Payload);
                    var unchanged = frame.Unchanged ?? Array.Empty<string>();
                    if (payload.TryGetValue("grid", out var grid))
                    {
                        Assert.DoesNotContain("grid", unchanged);
                        held = grid;
                    }
                    else
                    {
                        Assert.Equal(new[] { "grid" }, unchanged);
                        Assert.NotNull(held);
                        leftOut++;
                    }
                    var expected = probe.GridAtBuild((double)payload["build"]!);
                    var heldValues = ((List<object?>)held!).Select(v => (double)v!).ToArray();
                    Assert.Equal(expected, heldValues);
                }
                Assert.True(leftOut > 0, "no frame left the grid out");
                Assert.Contains(frames, f => ((Dictionary<string, object?>)f.Payload!).ContainsKey("grid") && f != frames[0]);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class GridProbeUplink : ISitrepUplink
        {
            public const string Topic = "held.grid";

            private readonly List<(int FromBuild, double[] Grid)> _grids = new List<(int, double[])> { (1, new[] { 1.0, 2.0, 3.0 }) };
            private int _builds;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-grid-probe",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 0.5, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.TrueNow,
                    },
                },
            };

            /// <summary>Retake the grid: every build from the next one carries a new array with new values.</summary>
            public void Retake()
            {
                lock (_grids)
                {
                    var next = _grids[_grids.Count - 1].Grid.Select(v => v + 10.0).ToArray();
                    _grids.Add((Volatile.Read(ref _builds) + 1, next));
                }
            }

            /// <summary>The grid the build numbered <paramref name="build"/> carried.</summary>
            public double[] GridAtBuild(double build)
            {
                lock (_grids)
                {
                    return _grids.Last(g => g.FromBuild <= build).Grid;
                }
            }

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, _ =>
                {
                    var build = Interlocked.Increment(ref _builds);
                    return new Dictionary<string, object?>
                    {
                        ["build"] = (double)build,
                        ["grid"] = GridAtBuild(build),
                    };
                });
            }

            public static KspSnapshot Snapshot() => new KspSnapshot
            {
                Values = new Dictionary<string, object?>(),
            };
        }
    }
}
