using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A command's gate verdict is published on the topic whose delay matches the command's own:
    /// live for an instant command, after the delay to home for a career order, and after the
    /// delay to the active craft for every other delayed command.
    /// </summary>
    public class GateTopicRoutingTests
    {
        private const string Gate = "always-no";
        private const string LedgerTopic = "probe.ledger";
        private const string CraftTopic = "probe.craft";

        [Fact]
        public void EachCommandsVerdictRidesTheTopicWhoseDelayMatchesTheCommand()
        {
            // Never started, so never disposed: Stop joins a thread that did not run.
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RoutedUplink());

            Assert.Equal(ChannelEngine.UplinkGatesTopic, engine.GateTopicOf("probe.instant"));
            Assert.Equal(ChannelEngine.UplinkGatesHomeTopic, engine.GateTopicOf("probe.career"));
            Assert.Equal(ChannelEngine.UplinkGatesCraftTopic, engine.GateTopicOf("probe.vessel"));
        }

        private sealed class RoutedUplink : ISitrepUplink
        {
            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "gate-routing",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    Channel(LedgerTopic, heldAtHome: true),
                    Channel(CraftTopic, heldAtHome: false),
                },
                Commands = new List<CommandDeclaration>
                {
                    Command("probe.instant", CraftTopic, DelayRole.TrueNow),
                    Command("probe.career", LedgerTopic, DelayRole.Delayed),
                    Command("probe.vessel", CraftTopic, DelayRole.Delayed),
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>("probe.instant", _ => "ok");
                host.AddCommandHandler<string, string>("probe.career", _ => "ok");
                host.AddCommandHandler<string, string>("probe.vessel", _ => "ok");
                host.AddGateEvaluator(new Evaluator());
            }

            private static ChannelDeclaration Channel(string topic, bool heldAtHome) => new ChannelDeclaration
            {
                Kind = SampleKind.Continuous,
                Topic = topic,
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
                HeldAtHome = heldAtHome,
            };

            private static CommandDeclaration Command(string id, string subject, DelayRole delay) => new CommandDeclaration
            {
                Command = id,
                Subject = subject,
                Delay = delay,
                Requires = new[] { new CommandRequirement { Kind = Gate } },
            };

            private sealed class Evaluator : ICommandGateEvaluator
            {
                public string Kind => Gate;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
                    GateVerdict.Fail(CommandErrorCode.ModeUnavailable, "no");
            }
        }
    }
}
