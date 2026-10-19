using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// An Uplink's refusal refinements: which the host accepts, what a result
    /// naming one is sent as, and how the roster tells a client that never
    /// loaded the Uplink's bundle what each one says.
    /// </summary>
    public class ErrorCodeRegistrationTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public void ADeclaredRefinementReachesTheCallerIntact()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CodeProbeUplink(CodeProbeUplink.Declared));
            engine.Start();
            try
            {
                var result = Dispatch(engine, CodeProbeUplink.RefuseDeclared);

                Assert.Equal(CodeProbeUplink.NotManaging, result.ErrorCode);
                Assert.Equal("codeProbe.notManaging", result.Reason);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void ARefinementItsUplinkNeverDeclaredReachesTheCallerAsSentAndIsLoggedOnce()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var lines = new List<string>();
            engine.SetDiagnosticLog(lines.Add);
            engine.RegisterUplink(new CodeProbeUplink(CodeProbeUplink.Declared));
            engine.Start();
            try
            {
                var first = Dispatch(engine, CodeProbeUplink.RefuseUndeclared);
                Dispatch(engine, CodeProbeUplink.RefuseUndeclared);

                Assert.False(first.Success);
                Assert.Equal(CommandErrorCode.WrongState, first.ErrorCode?.Root);
                Assert.Equal("codeProbe.neverDeclared", first.Reason);
                Assert.Equal("the probe said so", first.Detail);
                var undeclared = lines.FindAll(l => l.Contains("codeProbe.neverDeclared") && l.Contains("not declare"));
                Assert.Single(undeclared);
                Assert.Contains("codeProbe", undeclared[0]);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void ARefinementAnotherUplinkDeclaredIsNotLoggedAsUndeclared()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var lines = new List<string>();
            engine.SetDiagnosticLog(lines.Add);
            engine.RegisterUplink(new CodeProbeUplink(CodeProbeUplink.Declared));
            engine.RegisterUplink(new SiblingProbeUplink());
            engine.Start();
            try
            {
                var result = Dispatch(engine, CodeProbeUplink.RefuseSibling);

                Assert.Equal("siblingProbe.shared", result.Reason);
                Assert.DoesNotContain(lines, l => l.Contains("siblingProbe.shared"));
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void ACodeUnderAnotherUplinksIdDropsTheWholeSet()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CodeProbeUplink(
                CodeProbeUplink.NotManaging,
                CommandErrorCode.NotFound.Refine("someoneElse.missing", "someone else's code")));
            engine.Start();
            try
            {
                var result = Dispatch(engine, CodeProbeUplink.RefuseDeclared);

                Assert.Equal(CommandErrorCode.CareerModeRequired, result.ErrorCode?.Root);
                Assert.Equal("codeProbe.notManaging", result.Reason);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void AHandlerRaisingAFaultAnswersWithItAndKeepsTheCommandAvailable()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new CodeProbeUplink(CodeProbeUplink.Declared));
            engine.Start();
            try
            {
                for (var attempt = 0; attempt < 2; attempt++)
                {
                    var resolved = false;
                    FaultCode? fault = null;
                    engine.DispatchCommandAndWait(
                        CodeProbeUplink.Fault, null, "vantage-1",
                        _ => resolved = true,
                        Timeout,
                        onRefused: (code, _) => fault = code);

                    Assert.False(resolved);
                    Assert.Equal(FaultCode.MainThreadTimeout, fault);
                }
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public async Task TheRosterListsEachAcceptedRefinementWithItsRootAndSentence()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new CodeProbeUplink(CodeProbeUplink.Declared));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinksTopic, Timeout);
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
                var uplinks = Assert.IsType<List<object?>>(payload["uplinks"]);
                Dictionary<string, object?>? probe = null;
                foreach (var raw in uplinks)
                {
                    var entry = Assert.IsType<Dictionary<string, object?>>(raw);
                    if ((string?)entry["id"] == CodeProbeUplink.UplinkId) probe = entry;
                }

                Assert.NotNull(probe);
                var codes = Assert.IsType<List<object?>>(probe!["errorCodes"]);
                var code = Assert.IsType<Dictionary<string, object?>>(Assert.Single(codes));
                Assert.Equal("codeProbe.notManaging", code["id"]);
                Assert.Equal("careerModeRequired", code["refines"]);
                Assert.Equal("the probe is not managing this save", code["sentence"]);
            }
            finally { engine.Stop(); }
        }

        private static CommandResult Dispatch(ChannelEngine engine, string command)
        {
            object? captured = null;
            engine.DispatchCommandAndWait(command, null, "vantage-1", r => captured = r, Timeout);
            return Assert.IsType<CommandResult>(captured);
        }

        private sealed class CodeProbeUplink : ISitrepUplink
        {
            public const string UplinkId = "codeProbe";
            public const string RefuseDeclared = "codeProbe.refuseDeclared";
            public const string RefuseUndeclared = "codeProbe.refuseUndeclared";
            public const string Fault = "codeProbe.fault";
            public const string RefuseSibling = "codeProbe.refuseSibling";

            public static readonly RefusalCode NotManaging =
                CommandErrorCode.CareerModeRequired.Refine("codeProbe.notManaging", "the probe is not managing this save");

            private static readonly RefusalCode NeverDeclared =
                CommandErrorCode.WrongState.Refine("codeProbe.neverDeclared", "this was never declared");

            public static readonly RefusalCode[] Declared = { NotManaging };

            public CodeProbeUplink(params RefusalCode[] codes)
            {
                Manifest = new UplinkManifest
                {
                    Id = UplinkId,
                    Version = "1.0.0",
                    Commands = new List<CommandDeclaration>
                    {
                        new CommandDeclaration { Command = RefuseDeclared, Delay = DelayRole.TrueNow },
                        new CommandDeclaration { Command = RefuseUndeclared, Delay = DelayRole.TrueNow },
                        new CommandDeclaration { Command = Fault, Delay = DelayRole.TrueNow },
                        new CommandDeclaration { Command = RefuseSibling, Delay = DelayRole.TrueNow },
                    },
                    ErrorCodes = codes,
                };
            }

            public UplinkManifest Manifest { get; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<object, CommandResult>(RefuseDeclared, _ => CommandResult.Fail(NotManaging));
                host.AddCommandHandler<object, CommandResult>(RefuseUndeclared, _ => CommandResult.Fail(NeverDeclared, "the probe said so"));
                host.AddCommandHandler<object, CommandResult>(RefuseSibling, _ => CommandResult.Fail(SiblingProbeUplink.Shared));
                host.AddCommandHandler<object, CommandResult>(
                    Fault, _ => throw new CommandFaultException(FaultCode.MainThreadTimeout, "the probe did not get to it"));
            }
        }

        private sealed class SiblingProbeUplink : ISitrepUplink
        {
            public static readonly RefusalCode Shared =
                CommandErrorCode.WrongState.Refine("siblingProbe.shared", "the sibling refused");

            public SiblingProbeUplink()
            {
                Manifest = new UplinkManifest
                {
                    Id = "siblingProbe",
                    Version = "1.0.0",
                    ErrorCodes = new[] { Shared },
                };
            }

            public UplinkManifest Manifest { get; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host) { }
        }
    }
}
