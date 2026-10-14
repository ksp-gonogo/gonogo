using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command call whose arguments are unknown, missing or of the wrong type
    /// is refused with a sentence naming the argument, before the handler runs.
    /// </summary>
    public class CommandArgumentValidationTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private static string? Malformed(ChannelEngine engine, string command, object? args)
        {
            string? malformed = null;
            var resolved = false;
            engine.DispatchCommandAndWait(
                command, args, "vantage-1",
                _ => resolved = true,
                Timeout,
                onMalformed: reason => malformed = reason);
            Assert.False(resolved);
            return malformed;
        }

        private static ChannelEngine Started(RemoveProbe probe)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(probe);
            engine.Start();
            return engine;
        }

        [Fact]
        public void AnArgumentNameTheCommandDoesNotDeclareIsRefusedByName()
        {
            var probe = new RemoveProbe();
            using var engine = Started(probe);
            try
            {
                var reason = Malformed(engine, RemoveProbe.Command, new Dictionary<string, object?> { ["id"] = "n1" });
                Assert.NotNull(reason);
                Assert.Contains("\"id\"", reason);
                Assert.Contains("\"nodeId\"", reason);
                Assert.Equal(0, probe.Runs);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void ARequiredArgumentThatIsNotSentIsRefusedByName()
        {
            var probe = new RemoveProbe();
            using var engine = Started(probe);
            try
            {
                var reason = Malformed(engine, RemoveProbe.Command, new Dictionary<string, object?>());
                Assert.Contains("requires argument \"nodeId\"", reason);

                var none = Malformed(engine, RemoveProbe.Command, null);
                Assert.Contains("\"nodeId\"", none);
                Assert.Equal(0, probe.Runs);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void AnArgumentOfTheWrongTypeIsRefusedByName()
        {
            var probe = new RemoveProbe();
            using var engine = Started(probe);
            try
            {
                var reason = Malformed(engine, RemoveProbe.Command, new Dictionary<string, object?> { ["nodeId"] = 0.01 });
                Assert.Contains("argument \"nodeId\"", reason);
                Assert.Equal(0, probe.Runs);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void AnOptionalArgumentMayBeLeftOut()
        {
            var probe = new RemoveProbe();
            using var engine = Started(probe);
            try
            {
                string? result = null;
                engine.DispatchCommandAndWait(
                    RemoveProbe.OptionalCommand, new Dictionary<string, object?>(), "vantage-1",
                    r => result = r as string, Timeout);
                Assert.Equal("ok", result);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void ABuiltInCommandWithAnUnknownArgumentIsRefusedByName()
        {
            var probe = new RemoveProbe();
            using var engine = Started(probe);
            try
            {
                var reason = Malformed(engine, "system.gate.check", new Dictionary<string, object?> { ["cmd"] = "x" });
                Assert.Contains("\"cmd\"", reason);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public async Task OverTheWireANumberForTheSettingValueIsAnInvalidEnvelopeNamingTheArgument()
        {
            var probe = new RemoveProbe();
            using var engine = Started(probe);
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = "r1",
                    Command = ChannelEngine.WriteModSettingCommand,
                    Args = new Dictionary<string, object?> { ["uplink"] = "x", ["id"] = "y", ["value"] = 0.01 },
                    SentAt = 0.0,
                }));
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);
                Assert.Equal(FaultCode.InvalidEnvelope, error.Code);
                Assert.Equal("r1", error.RequestId);
                Assert.Contains("argument \"value\"", error.Message);
            }
            finally { engine.Stop(); }
        }

        private sealed class RemoveProbe : ISitrepUplink
        {
            public const string Command = "test.removeNode";
            public const string OptionalCommand = "test.optionalArgs";

            private int _runs;

            public int Runs => _runs;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "test-arg-validation",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.TrueNow },
                    new CommandDeclaration { Command = OptionalCommand, Delay = DelayRole.TrueNow },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<RemoveManeuverNodeArgs, string>(Command, a =>
                {
                    _runs++;
                    return a.NodeId;
                });
                host.AddCommandHandler<OptionalArgs, string>(OptionalCommand, _ => "ok");
            }
        }

        public class OptionalArgs
        {
            public string? Note { get; set; }
            public double? Amount { get; set; }
        }
    }
}
