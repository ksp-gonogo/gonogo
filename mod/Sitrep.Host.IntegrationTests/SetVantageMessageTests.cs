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
