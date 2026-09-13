using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <see cref="ChannelEngine.CurrentHomeCommand"/> is a snapshot the main-loop capture
    /// writes, and the elected claimant behind it is only ever asked on that thread.
    ///
    /// <para>The stock claimant reads CommNet's homes through <c>FindObjectsOfType</c>,
    /// which Unity refuses off its main thread. The homes here model that rule: read
    /// from any thread but the ticking one they throw and record the offence, so a
    /// caller that swallows the throw is still caught.</para>
    /// </summary>
    public class HomeCommandCaptureTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        private static readonly IReadOnlyList<HomeNodeFacts> Homes = new[]
        {
            new HomeNodeFacts(false, "Woomerang Station"),
            new HomeNodeFacts(true, "Kerbal Space Center"),
        };

        [Fact]
        public void BeforeTheFirstTick_HomeIsNotIdentified_AndTheClaimantIsNeverAsked()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var homes = new MainThreadOnlyHomes(Homes);
            HomeCommandElection.RegisterCapability(engine.Kernel, homes.Read);
            engine.ResolveCapabilities();
            engine.Start();
            try
            {
                Assert.Same(HomeCommand.NotIdentified, engine.CurrentHomeCommand);
                Assert.Equal(0, homes.MainThreadReads);
                Assert.Empty(homes.Violations);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void HomeIsCapturedOnTheMainThread_AndReadFromAnotherWithoutAskingTheClaimant()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var homes = new MainThreadOnlyHomes(Homes);
            HomeCommandElection.RegisterCapability(engine.Kernel, homes.Read);
            engine.ResolveCapabilities();
            engine.Start();
            using var main = new MainThreadTicker(engine, homes);
            try
            {
                Assert.True(main.FirstTickDone.Wait(Timeout), "the main-thread ticker never completed a tick");

                HomeCommand answer = HomeCommand.NotIdentified;
                for (var i = 0; i < 50; i++)
                {
                    answer = engine.CurrentHomeCommand;
                    Thread.Sleep(1);
                }

                Assert.True(answer.IsIdentified);
                Assert.Equal(HomeCentreIds.Mint(Homes)[1], answer.CentreId);
                Assert.True(homes.MainThreadReads > 0, "the claimant was never asked on the main thread");
                Assert.Empty(homes.Violations);
            }
            finally
            {
                main.Stop();
                engine.Stop();
            }
        }

        /// <summary>No capability declared at all: the engine answers not identified rather than throwing.</summary>
        [Fact]
        public void NoHomeCommandCapability_TicksAndAnswersNotIdentified()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.ResolveCapabilities();
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, null, Timeout);
                Assert.Same(HomeCommand.NotIdentified, engine.CurrentHomeCommand);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>Stands in for the Unity main loop: the only thread the homes answer on.</summary>
        private sealed class MainThreadTicker : IDisposable
        {
            private readonly ManualResetEventSlim _stop = new ManualResetEventSlim(false);
            private readonly Thread _thread;

            public MainThreadTicker(ChannelEngine engine, MainThreadOnlyHomes homes)
            {
                using var started = new ManualResetEventSlim(false);
                _thread = new Thread(() =>
                {
                    homes.MainThreadId = Thread.CurrentThread.ManagedThreadId;
                    started.Set();
                    var ut = 0.0;
                    while (!_stop.IsSet)
                    {
                        engine.TickAndWait(ut, null, Timeout);
                        FirstTickDone.Set();
                        ut += 1.0;
                        Thread.Sleep(2);
                    }
                })
                { IsBackground = true, Name = "test-unity-main-thread" };
                _thread.Start();
                started.Wait(Timeout);
            }

            public ManualResetEventSlim FirstTickDone { get; } = new ManualResetEventSlim(false);

            public void Stop()
            {
                _stop.Set();
                _thread.Join(Timeout);
            }

            public void Dispose()
            {
                Stop();
                _stop.Dispose();
                FirstTickDone.Dispose();
            }
        }

        private sealed class MainThreadOnlyHomes
        {
            private readonly IReadOnlyList<HomeNodeFacts> _homes;
            private readonly List<string> _violations = new List<string>();
            private int _mainThreadReads;

            public MainThreadOnlyHomes(IReadOnlyList<HomeNodeFacts> homes) => _homes = homes;

            /// <summary>Unset (-1) means no thread is main, so every read is an offence.</summary>
            public volatile int MainThreadId = -1;

            public int MainThreadReads => Volatile.Read(ref _mainThreadReads);

            public IReadOnlyList<string> Violations
            {
                get { lock (_violations) { return _violations.ToArray(); } }
            }

            public IReadOnlyList<HomeNodeFacts> Read()
            {
                var thread = Thread.CurrentThread;
                if (thread.ManagedThreadId != MainThreadId)
                {
                    lock (_violations)
                    {
                        _violations.Add("read on thread " + thread.ManagedThreadId + " (" + (thread.Name ?? "unnamed") + ")");
                    }

                    throw new InvalidOperationException("FindObjectsOfType can only be called from the main thread.");
                }

                Interlocked.Increment(ref _mainThreadReads);
                return _homes;
            }
        }
    }
}
