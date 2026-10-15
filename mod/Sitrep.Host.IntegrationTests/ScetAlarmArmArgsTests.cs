using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Sitrep.Host.Alarms;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// An <c>alarm.scet.arm</c> sent over the socket with exactly the arguments the
    /// app's alarm bridge sends for each condition kind is accepted. Each kind
    /// names only its own condition fields, so the host's argument check must
    /// take the others' defaults rather than refuse them as missing.
    /// </summary>
    public class ScetAlarmArmArgsTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        public static IEnumerable<object[]> EveryConditionKind() => new[]
        {
            new object[]
            {
                "time",
                new Dictionary<string, object?>
                {
                    ["kind"] = (double)ScetAlarmConditionKind.Time,
                    ["ut"] = 5000.0,
                    ["leadSeconds"] = 60.0,
                },
            },
            new object[]
            {
                "instant",
                new Dictionary<string, object?>
                {
                    ["kind"] = (double)ScetAlarmConditionKind.TopicInstant,
                    ["topic"] = "vessel.orbit",
                    ["fieldPath"] = "timeToAp",
                    ["leadSeconds"] = 30.0,
                },
            },
            new object[]
            {
                "threshold",
                new Dictionary<string, object?>
                {
                    ["kind"] = (double)ScetAlarmConditionKind.Threshold,
                    ["topic"] = "vessel.flight",
                    ["fieldPath"] = "altitude",
                    ["op"] = (double)ScetAlarmThresholdOp.GreaterThan,
                    ["threshold"] = 70000.0,
                    ["sustainSeconds"] = 0.0,
                },
            },
            new object[]
            {
                "contract parameter",
                new Dictionary<string, object?>
                {
                    ["kind"] = (double)ScetAlarmConditionKind.ContractParameter,
                    ["contractId"] = "contract-1",
                    ["parameterTitle"] = "Reach orbit",
                    ["targetState"] = (double)KspParameterState.Complete,
                    ["sustainSeconds"] = 0.0,
                },
            },
        };

        [Theory]
        [MemberData(nameof(EveryConditionKind))]
        public async Task AnArmWithTheAppsArgumentsIsAccepted(string kind, Dictionary<string, object?> condition)
        {
            var probe = new ArmProbe();
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(probe);
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = "arm-1",
                    Command = ArmProbe.Command,
                    Args = new Dictionary<string, object?>
                    {
                        ["id"] = "alarm-1",
                        ["name"] = "An alarm",
                        ["vantage"] = "",
                        ["subject"] = "game",
                        ["condition"] = condition,
                        ["onFire"] = new List<object?>(),
                        ["actsOn"] = "",
                    },
                    SentAt = 0.0,
                }));

                var answer = await AnswerTo(client, "arm-1");
                Assert.True(
                    answer is CommandResponse<object?>,
                    $"a {kind} arm was refused: {(answer as ErrorMsg)?.Message}");
                Assert.Equal(1, probe.Armed);
            }
            finally { engine.Stop(); }
        }

        private static async Task<object> AnswerTo(TestClient client, string requestId)
        {
            var deadline = DateTime.UtcNow + Timeout;
            while (true)
            {
                var remaining = deadline - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero)
                {
                    throw new TimeoutException($"No answer to {requestId} arrived within {Timeout}.");
                }
                var parsed = EnvelopeCodec.ParseServerMessage(await client.ReceiveAsync(remaining));
                if (parsed is CommandResponse<object?> response && response.RequestId == requestId)
                {
                    return response;
                }
                if (parsed is ErrorMsg error && error.RequestId == requestId)
                {
                    return error;
                }
            }
        }

        /// <summary>Takes <c>alarm.scet.arm</c> with its real argument type and arms the shipped roster.</summary>
        private sealed class ArmProbe : ISitrepUplink
        {
            public const string Command = "alarm.scet.arm";

            private readonly ScetAlarmRoster _roster = new ScetAlarmRoster();
            private int _armed;

            public int Armed => _armed;

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "scet-arm-args-test",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration { Command = Command, Delay = DelayRole.TrueNow },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddVantageCommandHandler<ScetAlarmArmArgs, CommandResult>(Command, (args, vantage) =>
                {
                    if (!_roster.Arm(args, vantage))
                    {
                        return CommandResult.Fail(CommandErrorCode.WrongState, "the roster refused the arm");
                    }
                    _armed++;
                    return CommandResult.Ok();
                });
            }
        }
    }
}
