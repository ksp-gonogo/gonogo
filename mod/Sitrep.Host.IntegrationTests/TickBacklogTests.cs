using System;
using System.Collections.Concurrent;
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
    /// A game that offers ticks faster than the Courier finishes them, which is
    /// what high time warp over a busy save does. Every job shares the Courier's
    /// one queue, so the ticks it has not reached are what a new connection's
    /// subscribe waits behind.
    /// </summary>
    public class TickBacklogTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        /// <summary>Ten ticks a real second at 10000x, as the addon's sampling gate offers them.</summary>
        private const double UtPerTick = 1000;

        /// <summary>Eight real minutes of that.</summary>
        private const int TicksOffered = 4800;

        /// <summary>The Courier finishes one tick in the time the game offers this many.</summary>
        private const int OffersPerFinishedTick = 4;

        [Fact]
        public async Task AFreshSubscribeIsAnsweredAfterALongWarpTheCourierCouldNotKeepUpWith()
        {
            var uplink = new HeldTickUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var watching = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(watching, HeldTickUplink.Topic, Timeout);

                var ut = 0.0;
                var taken = 0;
                for (var offer = 1; offer <= TicksOffered; offer++)
                {
                    ut += UtPerTick;
                    var offered = ut;
                    if (engine.TryTick(() => new KspSnapshot { Ut = offered }))
                    {
                        taken++;
                    }
                    if (offer % OffersPerFinishedTick == 0)
                    {
                        // The tick waiting behind it has started by the next offer, so the Courier's pace is the test's and not the machine's.
                        uplink.LetOneTickFinish();
                        uplink.WaitForTicksStarted(offer / OffersPerFinishedTick + 1, Timeout);
                    }
                }

                Assert.InRange(taken - uplink.TicksStarted, 0, ChannelEngine.TickBacklogLimit);

                await using var fresh = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await fresh.SendAsync("{\"type\":\"subscribe\",\"topic\":\"" + HeldTickUplink.Topic + "\"}");
                for (var i = 0; i < ChannelEngine.TickBacklogLimit; i++)
                {
                    uplink.LetOneTickFinish();
                }

                var ack = await ReceiveTypedAsync<EventMsg>(fresh, Timeout);
                Assert.Equal("subscribed", ack.Name);
                // The stream is where the game is, give or take the ticks declined while the last ones were worked on.
                Assert.InRange(ut - uplink.LastUt, 0, UtPerTick * OffersPerFinishedTick * (ChannelEngine.TickBacklogLimit + 1));
            }
            finally
            {
                uplink.LetEveryTickFinish();
                engine.Stop();
            }
        }

        [Fact]
        public async Task ATickIsDeclinedOnlyWhileTheCourierStillOwesTheLimit()
        {
            var uplink = new HeldTickUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var watching = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(watching, HeldTickUplink.Topic, Timeout);

                for (var i = 1; i <= ChannelEngine.TickBacklogLimit; i++)
                {
                    var ut = i;
                    Assert.True(engine.TryTick(() => new KspSnapshot { Ut = ut }));
                }
                Assert.False(engine.TryTick(() => new KspSnapshot { Ut = 10 }));

                uplink.LetEveryTickFinish();
                engine.TickAndWait(20, new KspSnapshot { Ut = 20 }, Timeout);
                Assert.True(engine.TryTick(() => new KspSnapshot { Ut = 30 }));
            }
            finally
            {
                uplink.LetEveryTickFinish();
                engine.Stop();
            }
        }

        /// <summary>
        /// Two things happen in the game while the Courier owes its limit: one
        /// that the game sample hands over once, and one that a main-thread
        /// capture does. Neither is looked at for the declined tick, and both
        /// arrive with the next tick taken.
        /// </summary>
        [Fact]
        public async Task WhatHappenedDuringADeclinedTickArrivesWithTheNextOneTaken()
        {
            var uplink = new HeldTickUplink();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var watching = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(watching, HeldTickUplink.Topic, Timeout);

                var sampled = new ConcurrentQueue<string>();
                var samples = 0;
                KspSnapshot Sample(double ut)
                {
                    samples++;
                    var events = new List<object?>();
                    while (sampled.TryDequeue(out var happened))
                    {
                        events.Add(happened);
                    }
                    return new KspSnapshot { Ut = ut, Values = new Dictionary<string, object?> { ["events"] = events } };
                }

                for (var i = 1; i <= ChannelEngine.TickBacklogLimit; i++)
                {
                    var ut = i;
                    Assert.True(engine.TryTick(() => Sample(ut)));
                }

                sampled.Enqueue("staged");
                uplink.Captured.Enqueue("part destroyed");
                Assert.False(engine.TryTick(() => Sample(10)));
                Assert.Equal(ChannelEngine.TickBacklogLimit, samples);
                Assert.Single(sampled);
                Assert.Single(uplink.Captured);

                uplink.LetEveryTickFinish();
                engine.TickAndWait(20, new KspSnapshot { Ut = 20 }, Timeout);
                Assert.True(engine.TryTick(() => Sample(30)));
                engine.TickAndWait(40, new KspSnapshot { Ut = 40 }, Timeout);

                Assert.Equal(new[] { "staged" }, uplink.SampledEventsSeen);
                Assert.Equal(new[] { "part destroyed" }, uplink.CapturedEventsHandled);
            }
            finally
            {
                uplink.LetEveryTickFinish();
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASlowTickSaysWhichChannelTookTheTime()
        {
            var uplink = new HeldTickUplink { MapperSeconds = ChannelEngine.SlowTickSeconds * 2 };
            uplink.LetEveryTickFinish();
            var logged = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetDiagnosticLog(logged.Enqueue);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var watching = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(watching, HeldTickUplink.Topic, Timeout);

                engine.TickAndWait(1, new KspSnapshot { Ut = 1 }, Timeout);
                engine.TickAndWait(2, new KspSnapshot { Ut = 2 }, Timeout);

                var report = Assert.Single(logged, line => line.Contains("slow tick"));
                Assert.Contains("of which " + HeldTickUplink.Topic, report);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task ASlowTickSaysWhichMainThreadCaptureTookTheTimeAndHowLongTheGameSampleTook()
        {
            var uplink = new HeldTickUplink { CaptureSeconds = ChannelEngine.SlowTickSeconds * 2 };
            uplink.LetEveryTickFinish();
            var logged = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetDiagnosticLog(logged.Enqueue);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                await using var watching = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(watching, HeldTickUplink.Topic, Timeout);

                Assert.True(engine.TryTick(() =>
                {
                    Thread.Sleep(TimeSpan.FromSeconds(ChannelEngine.SlowTickSeconds));
                    return new KspSnapshot { Ut = 1 };
                }));
                engine.TickAndWait(2, new KspSnapshot { Ut = 2 }, Timeout);

                var report = logged.First(line => line.Contains("slow tick"));
                Assert.Matches(@"sources \d+ of which tick-backlog-test \d+", report);
                var sampled = System.Text.RegularExpressions.Regex.Match(report, @"game sample (\d+) ms");
                Assert.True(sampled.Success, report);
                Assert.True(int.Parse(sampled.Groups[1].Value) >= ChannelEngine.SlowTickSeconds * 1000 * 0.9, report);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>One channel whose mapper does not return until the test lets that tick finish.</summary>
        private sealed class HeldTickUplink : ISitrepUplink
        {
            public const string Topic = "tickbacklog.ut";

            private readonly SemaphoreSlim _finish = new SemaphoreSlim(0, int.MaxValue);
            private volatile bool _held = true;
            private int _ticksStarted;
            private double _lastUt;

            /// <summary>Real seconds the mapper spends once it is let go.</summary>
            public double MapperSeconds { get; set; }

            /// <summary>Real seconds the main-thread capture takes.</summary>
            public double CaptureSeconds { get; set; }

            public int TicksStarted => Volatile.Read(ref _ticksStarted);

            /// <summary>What a main-thread capture hands over once, the way a capture that drains a queue of game events does.</summary>
            public ConcurrentQueue<string> Captured { get; } = new ConcurrentQueue<string>();

            /// <summary>Every captured event a handle received, in order.</summary>
            public ConcurrentQueue<string> CapturedEventsHandled { get; } = new ConcurrentQueue<string>();

            /// <summary>Every event the mapper found in a snapshot, in order.</summary>
            public ConcurrentQueue<string> SampledEventsSeen { get; } = new ConcurrentQueue<string>();

            public double LastUt => Volatile.Read(ref _lastUt);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "tick-backlog-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.TrueNow,
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddChannelSource(Topic, snapshot =>
                {
                    Interlocked.Increment(ref _ticksStarted);
                    if (_held)
                    {
                        _finish.Wait();
                    }
                    if (MapperSeconds > 0)
                    {
                        Thread.Sleep(TimeSpan.FromSeconds(MapperSeconds));
                    }
                    if (snapshot?.Values != null && snapshot.Values.TryGetValue("events", out var events) && events is List<object?> list)
                    {
                        foreach (var happened in list)
                        {
                            SampledEventsSeen.Enqueue((string)happened!);
                        }
                    }
                    var ut = snapshot?.Ut ?? 0.0;
                    Volatile.Write(ref _lastUt, ut);
                    return ut;
                });
                host.AddSampledSource(
                    _ =>
                    {
                        if (CaptureSeconds > 0)
                        {
                            Thread.Sleep(TimeSpan.FromSeconds(CaptureSeconds));
                        }
                        var drained = new List<string>();
                        while (Captured.TryDequeue(out var happened))
                        {
                            drained.Add(happened);
                        }
                        return drained;
                    },
                    captured =>
                    {
                        foreach (var happened in (List<string>)captured!)
                        {
                            CapturedEventsHandled.Enqueue(happened);
                        }
                    });
            }

            public void LetOneTickFinish() => _finish.Release();

            public void WaitForTicksStarted(int count, TimeSpan timeout)
            {
                if (!SpinWait.SpinUntil(() => TicksStarted >= count, timeout))
                {
                    throw new TimeoutException("tick " + count + " never started; " + TicksStarted + " had");
                }
            }

            public void LetEveryTickFinish()
            {
                _held = false;
                _finish.Release(1000);
            }
        }
    }
}
