using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A gate reads the call the way its handler will: an argument the wire left
    /// out is the default the handler acts on, not an absence.
    ///
    /// <para>A launch that omits <c>site</c> goes to the pad. Read from the raw
    /// bag, the gate saw no site at all and refused the call as undecidable,
    /// while the same gate named the site when the client spelled it out.</para>
    /// </summary>
    public class CommandGateOmittedArgumentTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        [Fact]
        public void AnOmittedArgumentIsJudgedAsTheDefaultTheHandlerWillUse()
        {
            var uplink = new SiteProbeUplink();
            var result = Dispatch(uplink, new Dictionary<string, object>());

            Assert.Equal("launched:LaunchPad", result);
            Assert.Equal(new[] { "LaunchPad" }, uplink.SitesJudged);
        }

        [Fact]
        public void ASuppliedArgumentIsJudgedAsSupplied()
        {
            var uplink = new SiteProbeUplink();
            var result = Dispatch(uplink, new Dictionary<string, object> { ["site"] = "Runway" });

            Assert.Equal("launched:Runway", result);
            Assert.Equal(new[] { "Runway" }, uplink.SitesJudged);
        }

        private static object? Dispatch(SiteProbeUplink uplink, object args)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                object? result = null;
                string? refusal = null;
                engine.DispatchCommandAndWait(
                    SiteProbeUplink.Command, args, "vantage-1",
                    r => result = r,
                    Timeout,
                    onRefused: (_, reason) => refusal = reason);

                Assert.Null(refusal);
                return result;
            }
            finally { engine.Stop(); }
        }

        public sealed class SiteArgs
        {
            public string Site { get; set; } = "LaunchPad";
        }

        private sealed class SiteProbeUplink : ISitrepUplink
        {
            public const string Command = "probe.launch";
            public const string GateKind = "probe-site";

            public List<string> SitesJudged { get; } = new List<string>();

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "site-probe",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = Command,
                        Delay = DelayRole.TrueNow,
                        Requires = new[] { new CommandRequirement { Kind = GateKind, Needs = new[] { "site" } } },
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<SiteArgs, string>(Command, args => "launched:" + args.Site);
                host.AddGateEvaluator(new Evaluator(SitesJudged));
            }

            private sealed class Evaluator : ICommandGateEvaluator
            {
                private readonly List<string> _judged;

                public Evaluator(List<string> judged) => _judged = judged;

                public string Kind => GateKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
                {
                    arguments.TryGet("site", out var site);
                    _judged.Add((string)site);
                    return GateVerdict.Pass();
                }
            }
        }
    }
}
