using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A gate whose answer depends on the sender's command centre as well as on
    /// the call's arguments, asked two ways: by a dispatch, and by
    /// <c>system.gate.check</c> before anything is sent.
    /// </summary>
    public class GateCheckTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public void ADispatchIsRefusedByAGateThatReadsTheSendersVantage()
        {
            using var engine = Started(out var uplink);
            try
            {
                var refused = Dispatch(engine, VantageUplink.Command, Site("Pad"), "far");

                Assert.False(refused.Success);
                Assert.Equal(CommandErrorCode.OutOfReach, refused.ErrorCode);
                Assert.Equal(0, uplink.Runs);

                var allowed = Dispatch(engine, VantageUplink.Command, Site("Pad"), "near");
                Assert.True(allowed.Success);
                Assert.Equal(1, uplink.Runs);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void ACheckAnswersTheVerdictForTheSendersVantageWithoutRunningTheCommand()
        {
            using var engine = Started(out var uplink);
            try
            {
                var far = Check(engine, VantageUplink.Command, Site("Pad"), "far");
                Assert.Equal(GateOutcome.Fail, far.Outcome);
                Assert.Equal(CommandErrorCode.OutOfReach, far.ErrorCode);
                Assert.Equal(VantageUplink.FarDetail, far.Detail);

                var near = Check(engine, VantageUplink.Command, Site("Pad"), "near");
                Assert.Equal(GateOutcome.Pass, near.Outcome);

                Assert.Equal(0, uplink.Runs);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void ACheckThatLeavesOutAnArgumentTheGateNeedsAbstains()
        {
            using var engine = Started(out var uplink);
            try
            {
                var verdict = Check(engine, VantageUplink.Command, new Dictionary<string, object>(), "far");

                Assert.Equal(GateOutcome.Abstain, verdict.Outcome);
                Assert.Equal(0, uplink.GateCalls);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void AnEvaluationWithNoVantageAbstainsWithoutAskingTheEvaluator()
        {
            using var engine = Started(out var uplink);
            try
            {
                var verdict = engine.EvaluateGates(VantageUplink.Command, new Args(Site("Pad")));

                Assert.Equal(GateOutcome.Abstain, verdict.Outcome);
                Assert.Equal(0, uplink.GateCalls);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void ACheckOfACommandThatIsNotKnownIsRefusedNamingIt()
        {
            using var engine = Started(out _);
            try
            {
                var result = DispatchCheck(engine, "nothing.registered.this", new Dictionary<string, object>(), "near");

                Assert.False(result.Success);
                Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
                Assert.Contains("nothing.registered.this", result.Detail);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void ACheckOfACommandWithNoGatePasses()
        {
            using var engine = Started(out _);
            try
            {
                var verdict = Check(engine, VantageUplink.UngatedCommand, new Dictionary<string, object>(), "near");

                Assert.Equal(GateOutcome.Pass, verdict.Outcome);
            }
            finally { engine.Stop(); }
        }

        private static Dictionary<string, object> Site(string site) =>
            new Dictionary<string, object> { ["site"] = site };

        private static ChannelEngine Started(out VantageUplink uplink)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            uplink = new VantageUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            return engine;
        }

        private static CommandResult Dispatch(
            ChannelEngine engine, string command, object args, string vantage)
        {
            object? result = null;
            engine.DispatchCommandAndWait(command, args, vantage, r => result = r, Timeout);
            return Assert.IsAssignableFrom<CommandResult>(result);
        }

        private static CommandResult DispatchCheck(
            ChannelEngine engine, string command, Dictionary<string, object> args, string vantage) =>
            Dispatch(
                engine,
                ChannelEngine.GateCheckCommand,
                new Dictionary<string, object> { ["command"] = command, ["args"] = args },
                vantage);

        private static GateVerdict Check(
            ChannelEngine engine, string command, Dictionary<string, object> args, string vantage)
        {
            var result = DispatchCheck(engine, command, args, vantage);
            Assert.True(result.Success, result.Detail);
            return Assert.IsType<CommandResult<GateVerdict>>(result).Payload!;
        }

        private sealed class Args : IGateArguments
        {
            private readonly Dictionary<string, object> _values;

            public Args(Dictionary<string, object> values) => _values = values;

            public bool TryGet(string path, out object value) => _values.TryGetValue(path, out value!);
        }

        private sealed class VantageUplink : ISitrepUplink, IVantageGateEvaluator
        {
            public const string Command = "test.vantage.launch";
            public const string UngatedCommand = "test.vantage.ungated";
            public const string FarDetail = "the far centre is outside the pad's system";

            private int _runs;
            private int _gateCalls;

            public int Runs => Volatile.Read(ref _runs);

            public int GateCalls => Volatile.Read(ref _gateCalls);

            public string Kind => "test-vantage";

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest
            {
                Id = "vantage-gate-test",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = Command,
                        Delay = DelayRole.TrueNow,
                        Requires = new[]
                        {
                            new CommandRequirement { Kind = Kind, Needs = new[] { "site" }, NeedsVantage = true },
                        },
                    },
                    new CommandDeclaration { Command = UngatedCommand, Delay = DelayRole.TrueNow },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddGateEvaluator(this);
                host.AddCommandHandler<object?, CommandResult>(Command, _ =>
                {
                    Interlocked.Increment(ref _runs);
                    return CommandResult.Ok();
                });
                host.AddCommandHandler<object?, CommandResult>(UngatedCommand, _ => CommandResult.Ok());
            }

            public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
                throw new InvalidOperationException("a requirement that needs the vantage was asked without one");

            public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments, string vantage)
            {
                Interlocked.Increment(ref _gateCalls);
                return vantage == "far"
                    ? GateVerdict.Fail(CommandErrorCode.OutOfReach, FarDetail)
                    : GateVerdict.Pass();
            }
        }
    }
}
