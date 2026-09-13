using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;
using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// Plan 3 set-vantage message: a client selects its command centre (vantage).
    /// The id must name a currently active command centre, else the prior vantage is
    /// kept and an error returns. No id is special: where a connection stands before it
    /// chooses is covered by <see cref="FreshConnectionVantageTests"/>.
    ///
    /// <para>The per-command override on <c>CommandRequest.Vantage</c> is the same
    /// rule's second entry point and is covered here too, deliberately in one file:
    /// the two paths are one rule, and the override went unchecked for as long as
    /// each had its own spelling.</para>
    ///
    /// <para>"Currently active" means active at the last main-loop tick, which is where
    /// the engine enumerates the sources, so a test that expects a centre to be
    /// selectable ticks once before it connects.</para>
    /// </summary>
    public class SetVantageMessageTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(400);

        [Fact]
        public async Task AnActiveCentre_IsSelectable_AndNoIdIsSelectableJustForItsSpelling()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(
                new StaticSource("ground:gs1", CommandCentreKind.GroundStation));
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // An active enumerated centre is selectable: no error is returned.
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                await client.AssertNoMessageArrivesAsync(Quiet);

                // "ksc" once named the stock space centre whether or not it was enumerated.
                // An id that names no active centre is refused, whatever it spells.
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ksc" }));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", error.Code);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public async Task UnknownCentre_KeepsPriorVantage_ReturnsError()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(
                new StaticSource("ground:gs1", CommandCentreKind.GroundStation));
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "no-such-centre" }));

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", error.Code);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The two tests above only prove the WIRE reaction (silence on accept,
        /// an <see cref="ErrorMsg"/> on reject): neither looks at
        /// <c>ClientSession.ChosenVantage</c> itself, so a `HandleSetVantage`
        /// that validated correctly but forgot the actual assignment (or
        /// applied a rejected id anyway) would still pass both. This test
        /// reads the session's real vantage indirectly, via the one place it
        /// is echoed back to the client: `CommandResponse.Meta.Vantage`.
        /// A valid switch must change that echo; a rejected switch must leave
        /// it exactly where it was, not fall back to where a fresh connection starts.
        /// </summary>
        [Fact]
        public async Task ValidCentre_ActuallySetsSessionVantage_AndARejectedSwitchLeavesItUnchanged()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(
                new StaticSource("ground:gs1", CommandCentreKind.GroundStation));
            engine.RegisterCommandCentreSource(
                new StaticSource("ground:gs2", CommandCentreKind.GroundStation));
            engine.RegisterUplink(new EchoVantageTestUplink());
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // Baseline: nothing chosen and no home identified, so the first ground station by id.
                var baseline = await DispatchAndAwaitResponse(client, "r0");
                Assert.Equal("ground:gs1", baseline.Meta.Vantage);

                // A valid switch actually moves the session, not
                // just the "no error" wire reaction already covered above.
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs2" }));
                var afterValid = await DispatchAndAwaitResponse(client, "r1");
                Assert.Equal("ground:gs2", afterValid.Meta.Vantage);

                // A rejected switch must not touch the session: neither
                // adopting the unknown id nor reverting to where it started.
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "no-such-centre" }));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", error.Code);

                var afterRejected = await DispatchAndAwaitResponse(client, "r2");
                Assert.Equal("ground:gs2", afterRejected.Meta.Vantage);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The per-command override is client-supplied and must answer to the same
        /// rule the set-vantage message does. The assertion is on the vantage the
        /// HANDLER was given, not on the wire reaction, because that argument is what
        /// a vantage-aware handler records as having asked for something
        /// (<c>ScetAlarm.ArmedBy</c>): a check that let the dispatch through and only
        /// corrected the response would still write the client's invention down.
        /// </summary>
        [Fact]
        public async Task PerCommandVantage_NamingAnInactiveCentre_IsRefused_AndNeverReachesTheHandler()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(
                new StaticSource("ground:gs1", CommandCentreKind.GroundStation));
            var uplink = new RecordVantageTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await SendCommandAsync(client, "r1", vantage: "ground:gs99");

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", error.Code);
                Assert.Equal("r1", error.RequestId);

                // Refused, not demoted: the handler ran for nobody. A silent fallback
                // would show up here as one entry reading the session vantage.
                Assert.Empty(uplink.SeenVantages);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The check must not cost the two overrides that are legitimate: an active
        /// centre, and <c>"meta"</c>, which is a delay exemption rather than a place
        /// and so is NOT an enumerated command centre. A validator copied verbatim
        /// from the set-vantage path would refuse every program-meta command.
        /// </summary>
        [Fact]
        public async Task PerCommandVantage_ActiveCentreAndMeta_ReachTheHandlerUnchanged()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(
                new StaticSource("ground:gs1", CommandCentreKind.GroundStation));
            var uplink = new RecordVantageTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            engine.TickAndWait(0.0, null, Timeout);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await SendCommandAsync(client, "r1", vantage: "ground:gs1");
                await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);

                await SendCommandAsync(client, "r2", vantage: "meta");
                await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);

                // An omitted override still resolves to the session vantage, which
                // HandleSetVantage validated when it was set: it is not re-checked, so
                // it cannot start failing when a centre goes inactive under a session.
                await SendCommandAsync(client, "r3", vantage: null);
                await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);

                Assert.Equal(new[] { "ground:gs1", "meta", "ground:gs1" }, uplink.SeenVantages);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A set-vantage request arrives on a socket thread, and the production
        /// home-node source answers through <c>FindObjectsOfType</c>, which Unity
        /// refuses off its main thread. <see cref="StaticSource"/> never objects to
        /// the thread it is called on, which is how validation came to enumerate the
        /// live registry from the socket thread with every test green. This source
        /// models the Unity rule: it throws when enumerated from any thread but the
        /// one ticking the engine, and records the offence so a caller that swallows
        /// the throw is still caught.
        /// </summary>
        [Fact]
        public async Task SetVantage_ValidatesWithoutEnumeratingSourcesOffTheMainThread()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var source = new MainThreadOnlySource("ground:gs1");
            engine.RegisterCommandCentreSource(source);
            engine.RegisterUplink(new EchoVantageTestUplink());
            engine.Start();
            using var main = new MainThreadTicker(engine, source);
            try
            {
                Assert.True(main.FirstTickDone.Wait(Timeout), "the main-thread ticker never completed a tick");

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                var afterValid = await DispatchAndAwaitResponse(client, "r1");
                Assert.Equal("ground:gs1", afterValid.Meta.Vantage);

                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "no-such-centre" }));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", error.Code);

                var afterRejected = await DispatchAndAwaitResponse(client, "r2");
                Assert.Equal("ground:gs1", afterRejected.Meta.Vantage);

                Assert.Empty(source.Violations);
                Assert.True(source.MainThreadEnumerations > 0, "the source was never enumerated on the main thread");
            }
            catch (OperationCanceledException)
            {
                AssertNoThreadViolation(source);
                throw;
            }
            finally
            {
                main.Stop();
                engine.Stop();
            }
        }

        /// <summary>
        /// The per-command override is the same rule's second entry point and runs
        /// on the same socket thread, so it is held to the same thread rule.
        /// </summary>
        [Fact]
        public async Task PerCommandVantage_ValidatesWithoutEnumeratingSourcesOffTheMainThread()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var source = new MainThreadOnlySource("ground:gs1");
            engine.RegisterCommandCentreSource(source);
            var uplink = new RecordVantageTestUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            using var main = new MainThreadTicker(engine, source);
            try
            {
                Assert.True(main.FirstTickDone.Wait(Timeout), "the main-thread ticker never completed a tick");

                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await SendCommandAsync(client, "r1", vantage: "ground:gs1");
                await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);

                await SendCommandAsync(client, "r2", vantage: "ground:gs99");
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", error.Code);
                Assert.Equal("r2", error.RequestId);

                await SendCommandAsync(client, "r3", vantage: null);
                await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);

                Assert.Equal(new[] { "ground:gs1", "ground:gs1" }, uplink.SeenVantages);
                Assert.Empty(source.Violations);
            }
            catch (OperationCanceledException)
            {
                AssertNoThreadViolation(source);
                throw;
            }
            finally
            {
                main.Stop();
                engine.Stop();
            }
        }

        /// <summary>
        /// A client can connect before the main loop has ticked once (the socket is up
        /// from the menu onwards). Until a tick has captured the active centres, no vantage
        /// is selectable: no centre is known to be active, and the sources cannot be asked
        /// from here.
        /// </summary>
        [Fact]
        public async Task BeforeTheFirstTick_NoVantageIsSelectable()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var source = new MainThreadOnlySource("ground:gs1");
            engine.RegisterCommandCentreSource(source);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", error.Code);

                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ksc" }));
                var refused = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", refused.Code);

                Assert.Empty(source.Violations);
            }
            catch (OperationCanceledException)
            {
                AssertNoThreadViolation(source);
                throw;
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A source enumerated off the main thread throws on the socket thread, which
        /// closes the connection, so the test first sees a reply that never arrives.
        /// Naming the offending thread turns that timeout into the actual defect.
        /// </summary>
        private static void AssertNoThreadViolation(MainThreadOnlySource source)
        {
            var violations = source.Violations;
            Assert.True(violations.Count == 0, "no reply arrived, and a command-centre source was " + string.Join("; ", violations));
        }

        private static Task SendCommandAsync(TestClient client, string requestId, string? vantage) =>
            client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = RecordVantageTestUplink.Command,
                Vantage = vantage,
                Args = null,
                SentAt = 0.0,
            }));

        /// <summary>
        /// Records the vantage argument every dispatch hands its handler, the same
        /// argument <c>ScetAlarmUplink.HandleArm</c> writes into <c>ArmedBy</c>.
        /// </summary>
        private sealed class RecordVantageTestUplink : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public const string UplinkId = "test-record-vantage";
            public const string Command = "record.vantage";

            private readonly List<string> _seen = new List<string>();

            /// <summary>Handlers run on the engine's job thread, the test asserts on its own.</summary>
            public IReadOnlyList<string> SeenVantages
            {
                get { lock (_seen) { return _seen.ToArray(); } }
            }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.TrueNow },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddVantageCommandHandler<object?, object?>(Command, (_, vantage) =>
                {
                    lock (_seen) { _seen.Add(vantage); }
                    return null;
                });
            }
        }

        private static async Task<CommandResponse<object?>> DispatchAndAwaitResponse(TestClient client, string requestId)
        {
            await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
            {
                Type = "command-request",
                RequestId = requestId,
                Command = EchoVantageTestUplink.Command,
                Args = null,
                SentAt = 0.0,
            }));
            return await ReceiveTypedAsync<CommandResponse<object?>>(client, Timeout);
        }

        private sealed class EchoVantageTestUplink : ISitrepUplink
        {
            // Mandatory health floor (test double).
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public const string UplinkId = "test-echo-vantage";
            public const string Command = "echo.vantage";

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.TrueNow },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<object?, object?>(Command, _ => null);
            }
        }

        /// <summary>
        /// Stands in for the Unity main loop: a dedicated thread ticking the engine, the
        /// only thread its <see cref="MainThreadOnlySource"/> will answer on.
        /// </summary>
        private sealed class MainThreadTicker : IDisposable
        {
            private readonly ManualResetEventSlim _stop = new ManualResetEventSlim(false);
            private readonly Thread _thread;

            public MainThreadTicker(ChannelEngine engine, MainThreadOnlySource source)
            {
                using var started = new ManualResetEventSlim(false);
                _thread = new Thread(() =>
                {
                    source.MainThreadId = Thread.CurrentThread.ManagedThreadId;
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

        /// <summary>
        /// A command-centre source under Unity's rule: enumerating it from any thread
        /// other than <see cref="MainThreadId"/> throws, as <c>FindObjectsOfType</c> does.
        /// The check sits inside the iterator so it fires where the real source's does,
        /// on the first <c>MoveNext</c>.
        /// </summary>
        private sealed class MainThreadOnlySource : ICommandCentreSource
        {
            private readonly ICommandCentre _centre;
            private readonly List<string> _violations = new List<string>();
            private int _mainThreadEnumerations;

            public MainThreadOnlySource(string id) =>
                _centre = new StaticSource(id, CommandCentreKind.GroundStation).Enumerate().First();

            /// <summary>Unset (-1) means no thread is main, so every enumeration is an offence.</summary>
            public volatile int MainThreadId = -1;

            public string ProviderId => "main-thread-only-test";

            public int MainThreadEnumerations => Volatile.Read(ref _mainThreadEnumerations);

            public IReadOnlyList<string> Violations
            {
                get { lock (_violations) { return _violations.ToArray(); } }
            }

            public IEnumerable<ICommandCentre> Enumerate()
            {
                var thread = Thread.CurrentThread;
                if (thread.ManagedThreadId != MainThreadId)
                {
                    lock (_violations)
                    {
                        _violations.Add("enumerated on thread " + thread.ManagedThreadId + " (" + (thread.Name ?? "unnamed") + ")");
                    }

                    throw new InvalidOperationException("FindObjectsOfType can only be called from the main thread.");
                }

                Interlocked.Increment(ref _mainThreadEnumerations);
                yield return _centre;
            }
        }

        private sealed class StaticSource : ICommandCentreSource
        {
            private readonly ICommandCentre _centre;

            public StaticSource(string id, CommandCentreKind kind) => _centre = new Centre(id, kind);

            public string ProviderId => "static-test";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                yield return _centre;
            }

            private sealed class Centre : ICommandCentre
            {
                public Centre(string id, CommandCentreKind kind)
                {
                    Id = id;
                    Kind = kind;
                }

                public string Id { get; }
                public string DisplayName => Id;
                public CommandCentreKind Kind { get; }
                public int? BodyIndex => null;
                public bool IsActiveNow() => true;
            }
        }
    }
}
