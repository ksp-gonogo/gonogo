using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// What the log says of time the Courier spends inside one handle: the
    /// slow-tick report names the handle's slowest step, and a job that holds
    /// the Courier for long is reported while it runs and when it ends.
    /// </summary>
    public class CourierStepsTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public void ASlowTickNamesTheSlowestStepOfTheSlowestHandle()
        {
            /*
             * The tick is made slow in real time, which a loaded machine can only
             * lengthen. Which step is slowest is decided on a clock the handle
             * moves itself, so a pause anywhere else cannot change the answer.
             */
            long stepClock = 0;
            var uplink = new SteppedUplink
            {
                SlowStepSeconds = ChannelEngine.SlowTickSeconds * 1.5,
                OnSlowStep = () => Interlocked.Add(ref stepClock, 1_000_000),
            };
            uplink.Release();
            var logged = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.Steps.Timestamp = () => Interlocked.Read(ref stepClock);
            engine.SetDiagnosticLog(logged.Enqueue);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                engine.TickAndWait(1, new KspSnapshot { Ut = 1 }, Timeout);

                var report = Assert.Single(logged, line => line.Contains("slow tick"));
                Assert.Matches(@"of which courier-steps-test \d+ \(slowest step slow \d+\)", report);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACourierJobThatRunsLongIsReportedWhileTicksAreDeclinedAndWhenItEnds()
        {
            /*
             * The threshold is moved by the test rather than waited out: a job
             * held below it is never reported however long the machine stalls,
             * and one held past a threshold of zero always is.
             */
            var uplink = new SteppedUplink { Held = true };
            var logged = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0) { CourierStuckSeconds = double.MaxValue };
            engine.SetDiagnosticLog(logged.Enqueue);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                Assert.True(engine.TryTick(() => new KspSnapshot { Ut = 1 }));
                Assert.True(uplink.Entered.Wait(Timeout));
                Assert.True(engine.TryTick(() => new KspSnapshot { Ut = 2 }));

                Assert.False(engine.TryTick(() => new KspSnapshot { Ut = 3 }));
                Assert.DoesNotContain(logged, line => line.Contains("the Courier has been running"));

                engine.CourierStuckSeconds = 0;
                Assert.False(engine.TryTick(() => new KspSnapshot { Ut = 4 }));
                Assert.False(engine.TryTick(() => new KspSnapshot { Ut = 5 }));

                var stuck = Assert.Single(logged, line => line.Contains("the Courier has been running"));
                Assert.Matches(@"one TickJob for \d+ s, in courier-steps-test step held for \d+ s; \d+ clock callbacks fired in it, \d+ ticks declined", stuck);

                uplink.Release();
                engine.TickAndWait(6, new KspSnapshot { Ut = 6 }, Timeout);
                Assert.Contains(logged, line => line.Contains("a Courier TickJob ran for"));
            }
            finally
            {
                uplink.Release();
                engine.Stop();
            }
        }

        /// <summary>One sampled source whose handle names two steps, the second of which can be slow or held.</summary>
        private sealed class SteppedUplink : ISitrepUplink
        {
            private readonly ManualResetEventSlim _go = new ManualResetEventSlim(false);

            /// <summary>Real seconds the handle spends in its step "slow".</summary>
            public double SlowStepSeconds { get; set; }

            /// <summary>Run as the handle enters its step "slow".</summary>
            public Action? OnSlowStep { get; set; }

            /// <summary>Whether the handle waits in its step "held" until <see cref="Release"/>.</summary>
            public bool Held { get; set; }

            /// <summary>Set once a handle has reached the step it may be held in.</summary>
            public ManualResetEventSlim Entered { get; } = new ManualResetEventSlim(false);

            public void Release() => _go.Set();

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "courier-steps-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public void Register(IUplinkHost host)
            {
                host.AddSampledSource(
                    _ => new object(),
                    _ =>
                    {
                        CourierSteps.Mark("quick");
                        if (SlowStepSeconds > 0)
                        {
                            CourierSteps.Mark("slow");
                            OnSlowStep?.Invoke();
                            Thread.Sleep(TimeSpan.FromSeconds(SlowStepSeconds));
                        }
                        if (Held)
                        {
                            CourierSteps.Mark("held");
                            Entered.Set();
                            _go.Wait();
                        }
                        CourierSteps.Mark("done");
                    });
            }
        }
    }
}
