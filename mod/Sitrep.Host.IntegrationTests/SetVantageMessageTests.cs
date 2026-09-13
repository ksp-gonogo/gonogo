using System;
using System.Collections.Generic;
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
    /// The default "ksc" is always selectable; any other id must name a currently
    /// active command centre, else the prior vantage is kept and an error returns.
    ///
    /// <para>The per-command override on <c>CommandRequest.Vantage</c> is the same
    /// rule's second entry point and is covered here too, deliberately in one file:
    /// the two paths are one rule, and the override went unchecked for as long as
    /// each had its own spelling.</para>
    /// </summary>
    public class SetVantageMessageTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(400);

        [Fact]
        public async Task ActiveCentreAndKsc_AreSelectable_NoError()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(
                new StaticSource("ground:gs1", CommandCentreKind.GroundStation));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // An active enumerated centre is selectable: no error is returned.
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                await client.AssertNoMessageArrivesAsync(Quiet);

                // The default vantage is always selectable, even with no home-node source.
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ksc" }));
                await client.AssertNoMessageArrivesAsync(Quiet);
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
        /// <c>ClientSession.SelectedVantage</c> itself, so a `HandleSetVantage`
        /// that validated correctly but forgot the actual assignment (or
        /// applied a rejected id anyway) would still pass both. This test
        /// reads the session's real vantage indirectly, via the one place it
        /// is echoed back to the client: `CommandResponse.Meta.Vantage`
        /// (`ChannelEngine.OnMessageReceived`'s `Vantage = session.SelectedVantage`).
        /// A valid switch must change that echo; a rejected switch must leave
        /// it exactly where it was, not fall back to the default either.
        /// </summary>
        [Fact]
        public async Task ValidCentre_ActuallySetsSessionVantage_AndARejectedSwitchLeavesItUnchanged()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterCommandCentreSource(
                new StaticSource("ground:gs1", CommandCentreKind.GroundStation));
            engine.RegisterUplink(new EchoVantageTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                // Baseline: nothing set yet, session starts on the default.
                var baseline = await DispatchAndAwaitResponse(client, "r0");
                Assert.Equal("ksc", baseline.Meta.Vantage);

                // A valid switch actually moves session.SelectedVantage, not
                // just the "no error" wire reaction already covered above.
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "ground:gs1" }));
                var afterValid = await DispatchAndAwaitResponse(client, "r1");
                Assert.Equal("ground:gs1", afterValid.Meta.Vantage);

                // A rejected switch must not touch the session: neither
                // adopting the unknown id nor reverting to the default.
                await client.SendAsync(EnvelopeCodec.WriteSetVantage(new SetVantage { CentreId = "no-such-centre" }));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", error.Code);

                var afterRejected = await DispatchAndAwaitResponse(client, "r2");
                Assert.Equal("ground:gs1", afterRejected.Meta.Vantage);
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
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await SendCommandAsync(client, "r1", vantage: "ground:gs99");

                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal("unknown-vantage", error.Code);
                Assert.Equal("r1", error.RequestId);

                // Refused, not demoted: the handler ran for nobody. A silent fallback
                // would show up here as one entry reading "ksc".
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

                Assert.Equal(new[] { "ground:gs1", "meta", "ksc" }, uplink.SeenVantages);
            }
            finally
            {
                engine.Stop();
            }
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
