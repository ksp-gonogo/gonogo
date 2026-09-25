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
        private static readonly TimeSpan Timeout = TestBudgets.Op;

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

        /// <summary>
        /// A claimant outside core names home by picking one of the centres the capture
        /// hands it, so its answer is an id core minted and the roster carries.
        /// </summary>
        [Fact]
        public void TheClaimantIsHandedTheActiveCentresOfTheSameCapture()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var picker = new LastGroundStationClaimant();
            engine.RegisterCommandCentreSource(new FixedSource(
                new FixedCentre("vessel:crewed", CommandCentreKind.CrewedVessel),
                new FixedCentre("ground:Relay", CommandCentreKind.GroundStation),
                new FixedCentre("ground:Relay#2", CommandCentreKind.GroundStation)));
            HomeCommandElection.RegisterCapability(engine.Kernel, () => Homes);
            engine.Kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = HomeCommandCapability.Id,
                Id = "picker",
                Factory = _ => picker,
            });
            engine.ResolveCapabilities();
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, null, Timeout);

                Assert.Equal(new[] { "vessel:crewed", "ground:Relay", "ground:Relay#2" }, picker.LastHandedIds);
                Assert.Equal("ground:Relay#2", engine.CurrentHomeCommand.CentreId);
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class LastGroundStationClaimant : IHomeCommandProvider
        {
            public volatile string[] LastHandedIds = new string[0];

            public string ProviderId => "picker";

            public HomeCommand Identify(IReadOnlyList<ICommandCentre> activeCentres)
            {
                var ids = new string[activeCentres.Count];
                string? last = null;
                for (var i = 0; i < activeCentres.Count; i++)
                {
                    ids[i] = activeCentres[i].Id;
                    if (activeCentres[i].Kind == CommandCentreKind.GroundStation)
                    {
                        last = activeCentres[i].Id;
                    }
                }

                LastHandedIds = ids;
                return last == null ? HomeCommand.NotIdentified : HomeCommand.Identified(last);
            }
        }

        private sealed class FixedSource : ICommandCentreSource
        {
            private readonly ICommandCentre[] _centres;

            public FixedSource(params ICommandCentre[] centres) => _centres = centres;

            public string ProviderId => "home-capture-test";

            public IEnumerable<ICommandCentre> Enumerate() => _centres;
        }

        private sealed class FixedCentre : ICommandCentre
        {
            public FixedCentre(string id, CommandCentreKind kind)
            {
                Id = id;
                Kind = kind;
            }

            public string Id { get; }
            public string DisplayName => Id;
            public CommandCentreKind Kind { get; }
            public int? BodyIndex => null;
            public double? Latitude => null;
            public double? Longitude => null;
            public bool IsActiveNow() => true;
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
            private Exception? _fault;

            public MainThreadTicker(ChannelEngine engine, MainThreadOnlyHomes homes)
            {
                using var started = new ManualResetEventSlim(false);
                _thread = new Thread(() =>
                {
                    homes.MainThreadId = Thread.CurrentThread.ManagedThreadId;
                    started.Set();
                    var ut = 0.0;
                    try
                    {
                        while (!_stop.IsSet)
                        {
                            engine.TickAndWait(ut, null, Timeout);
                            FirstTickDone.Set();
                            ut += 1.0;
                            Thread.Sleep(2);
                        }
                    }
                    catch (Exception ex)
                    {
                        // An exception escaping a raw thread kills the test host, so the
                        // fault is carried to Stop and fails the test that owns it.
                        _fault = ex;
                    }
                })
                { IsBackground = true, Name = "test-unity-main-thread" };
                _thread.Start();
                if (!started.Wait(Timeout))
                {
                    throw new TimeoutException("the main-thread ticker did not start within " + Timeout);
                }
            }

            public ManualResetEventSlim FirstTickDone { get; } = new ManualResetEventSlim(false);

            public void Stop()
            {
                _stop.Set();
                if (!_thread.Join(Timeout))
                {
                    throw new TimeoutException("the main-thread ticker did not stop within " + Timeout);
                }
                var fault = Interlocked.Exchange(ref _fault, null);
                if (fault != null)
                {
                    throw new InvalidOperationException("the main-thread ticker faulted", fault);
                }
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
