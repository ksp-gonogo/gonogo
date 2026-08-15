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
                    new CommandDeclaration { Command = Command, Delayed = false },
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

            public string SourceId => "static-test";

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
