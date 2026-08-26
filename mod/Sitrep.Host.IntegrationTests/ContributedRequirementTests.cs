using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// <see cref="IUplinkHost.AddCommandRequirement"/>: an Uplink imposing its own
    /// precondition on a command somebody else declared.
    ///
    /// <para><b>Why the seam exists.</b> The Uplink that declares a command knows
    /// what the GAME requires of it, and cannot know what an installed mod
    /// requires. <c>ksp.launch</c> is the case that forced it: stock will fly any
    /// craft file, and under a career overhaul the article that flies is one a
    /// launch complex integrated and rolled out, so a launch that skips both
    /// passes every stock test on the way past.</para>
    ///
    /// <para><b>Contribution, not election.</b> Preconditions compose, and the
    /// two properties that makes load-bearing are both pinned below: every
    /// contribution holds in addition to the owner's, and the owner's are
    /// evaluated FIRST so a contribution that abstains cannot hide an answer the
    /// game could give in advance.</para>
    /// </summary>
    public class ContributedRequirementTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

        private const string OwnedCommand = "owner.launch";
        private const string UngatedCommand = "owner.ping";
        private const string OwnerKind = "owner-static";
        private const string ContributorKind = "contributor-condition";

        /// <summary>An argument bag a dispatch would carry.</summary>
        private sealed class Args : IGateArguments
        {
            private readonly Dictionary<string, object> _values = new Dictionary<string, object>(StringComparer.Ordinal);

            public static Args With(string key, string value)
            {
                var args = new Args();
                args._values[key] = value;
                return args;
            }

            public bool TryGet(string path, out object value) => _values.TryGetValue(path, out value!);
        }

        /// <summary>Nothing supplied: the addressability question the sampler asks.</summary>
        private sealed class NoArgs : IGateArguments
        {
            public bool TryGet(string path, out object value)
            {
                value = null!;
                return false;
            }
        }

        /// <summary>
        /// A command's owner. Its own requirement is static, so it decides with no
        /// arguments at all, which is what a contribution must not be able to
        /// suppress.
        /// </summary>
        private sealed class OwnerUplink : ISitrepUplink
        {
            private readonly GateOutcome _ownVerdict;
            private readonly bool _declareRequirement;

            public OwnerUplink(GateOutcome ownVerdict = GateOutcome.Pass, bool declareRequirement = true)
            {
                _ownVerdict = ownVerdict;
                _declareRequirement = declareRequirement;
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest => new UplinkManifest
            {
                Id = "owner",
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = OwnedCommand,
                        Delayed = false,
                        Requires = _declareRequirement
                            ? new[] { new CommandRequirement { Kind = OwnerKind } }
                            : new CommandRequirement[0],
                    },
                    new CommandDeclaration { Command = UngatedCommand, Delayed = false },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<object?, CommandResult>(OwnedCommand, _ => CommandResult.Ok());
                host.AddCommandHandler<object?, CommandResult>(UngatedCommand, _ => CommandResult.Ok());
                if (_declareRequirement)
                {
                    host.AddGateEvaluator(new StaticGate(_ownVerdict));
                }
            }

            private sealed class StaticGate : ICommandGateEvaluator
            {
                private readonly GateOutcome _outcome;
                public StaticGate(GateOutcome outcome) => _outcome = outcome;

                public string Kind => OwnerKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
                    _outcome == GateOutcome.Fail
                        ? GateVerdict.Fail(CommandErrorCode.SiteOccupied, "the pad is occupied")
                        : GateVerdict.Pass();
            }
        }

        /// <summary>
        /// An installed mod's Uplink, imposing conditions on somebody else's
        /// command. Its requirements name the argument they need, so they abstain
        /// until a dispatch supplies it, exactly as RP-1's do.
        /// </summary>
        private sealed class ContributorUplink : ISitrepUplink
        {
            private readonly string _targetCommand;
            private readonly string[] _conditions;
            private readonly bool _registerEvaluator;

            public ContributorUplink(
                string targetCommand = OwnedCommand,
                bool registerEvaluator = true,
                params string[] conditions)
            {
                _targetCommand = targetCommand;
                _registerEvaluator = registerEvaluator;
                _conditions = conditions.Length > 0 ? conditions : new[] { "built" };
            }

            /// <summary>Which conditions were asked, in order, across the whole run.</summary>
            public List<string> Asked { get; } = new List<string>();

            /// <summary>Conditions that answer no. Anything else passes.</summary>
            public HashSet<string> Refuse { get; } = new HashSet<string>(StringComparer.Ordinal);

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "contributor",
                Version = "1.0.0",
            };

            public void Register(IUplinkHost host)
            {
                if (_registerEvaluator)
                {
                    host.AddGateEvaluator(new ConditionGate(this));
                }
                foreach (var condition in _conditions)
                {
                    host.AddCommandRequirement(_targetCommand, new CommandRequirement
                    {
                        Kind = ContributorKind,
                        Quantity = condition,
                        Needs = new[] { "shipName" },
                    });
                }
            }

            private sealed class ConditionGate : ICommandGateEvaluator
            {
                private readonly ContributorUplink _owner;
                public ConditionGate(ContributorUplink owner) => _owner = owner;

                public string Kind => ContributorKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
                {
                    _owner.Asked.Add(requirement.Quantity);
                    return _owner.Refuse.Contains(requirement.Quantity)
                        ? GateVerdict.Fail(CommandErrorCode.NotReady, requirement.Quantity + " is outstanding")
                        : GateVerdict.Pass();
                }
            }
        }

        /// <summary>
        /// The case the seam was built for: an installed mod refuses a command
        /// whose owner declared nothing about the condition, and the refusal
        /// carries the contributor's own code and sentence.
        /// </summary>
        [Fact]
        public void AContributionRefusesACommandItsOwnerKnowsNothingAbout()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var contributor = new ContributorUplink();
            contributor.Refuse.Add("built");
            engine.RegisterUplink(new OwnerUplink());
            engine.RegisterUplink(contributor);
            engine.Start();
            try
            {
                var verdict = engine.EvaluateGates(OwnedCommand, Args.With("shipName", "V-2"));

                Assert.Equal(GateOutcome.Fail, verdict.Outcome);
                Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
                Assert.Equal("built is outstanding", verdict.Detail);
            }
            finally { engine.Stop(); }
        }

        /// <summary>Nothing outstanding leaves the command exactly as gated as its owner made it.</summary>
        [Fact]
        public void AContributionThatIsSatisfiedChangesNothing()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OwnerUplink());
            engine.RegisterUplink(new ContributorUplink());
            engine.Start();
            try
            {
                Assert.Equal(
                    GateOutcome.Pass,
                    engine.EvaluateGates(OwnedCommand, Args.With("shipName", "V-2")).Outcome);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// The ORDER property, and the reason the engine keeps the two lists
        /// apart. The owner's requirement is static and can say no in advance; the
        /// contribution needs an argument and abstains without one. Asked with an
        /// empty bag, the answer must be the owner's refusal, because abstention
        /// returns immediately and would otherwise turn a control that goes dark
        /// with a reason into one that fails the press.
        /// </summary>
        [Fact]
        public void AnAbstainingContributionCannotHideTheOwnersAdvanceAnswer()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OwnerUplink(GateOutcome.Fail));
            engine.RegisterUplink(new ContributorUplink());
            engine.Start();
            try
            {
                var verdict = engine.EvaluateGates(OwnedCommand, new NoArgs());

                Assert.Equal(GateOutcome.Fail, verdict.Outcome);
                Assert.Equal(CommandErrorCode.SiteOccupied, verdict.ErrorCode);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// With the owner satisfied, an argument-dependent contribution abstains
        /// rather than deciding. Abstain is drawn live: the only honest advance
        /// answer to "may some unspecified craft fly" is nothing.
        /// </summary>
        [Fact]
        public void AContributionThatNeedsAnArgumentAbstainsUntilItArrives()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var contributor = new ContributorUplink();
            contributor.Refuse.Add("built");
            engine.RegisterUplink(new OwnerUplink());
            engine.RegisterUplink(contributor);
            engine.Start();
            try
            {
                Assert.Equal(GateOutcome.Abstain, engine.EvaluateGates(OwnedCommand, new NoArgs()).Outcome);
                Assert.Empty(contributor.Asked);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// Several contributions from one Uplink are asked in the order they were
        /// contributed, so the Uplink can put the condition that explains the
        /// others first.
        /// </summary>
        [Fact]
        public void ContributionsAreAskedInTheOrderTheyArrived()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var contributor = new ContributorUplink(OwnedCommand, true, "built", "loaded", "rolledOut");
            contributor.Refuse.Add("rolledOut");
            engine.RegisterUplink(new OwnerUplink());
            engine.RegisterUplink(contributor);
            engine.Start();
            try
            {
                var verdict = engine.EvaluateGates(OwnedCommand, Args.With("shipName", "V-2"));

                Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
                Assert.Equal(new[] { "built", "loaded", "rolledOut" }, contributor.Asked);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// A contribution nobody can evaluate is a startup failure, for the same
        /// reason a declared requirement with no evaluator is: it reads exactly
        /// like a condition that is being enforced and enforces nothing.
        /// </summary>
        [Fact]
        public void AContributedKindWithNoEvaluatorRefusesToStart()
        {
            // Not disposed: Start throws before the courier thread exists, and
            // Stop joins a thread that was never started.
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OwnerUplink());
            engine.RegisterUplink(new ContributorUplink(OwnedCommand, registerEvaluator: false));

            var ex = Assert.Throws<InvalidOperationException>(() => engine.Start());
            Assert.Contains(ContributorKind, ex.Message);
        }

        /// <summary>
        /// A contribution to a command that does not exist constrains nothing, and
        /// the shape of the mistake is a typo in a command id that the contributing
        /// Uplink has no way to notice.
        /// </summary>
        [Fact]
        public void AContributionToACommandNobodyDeclaresRefusesToStart()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new OwnerUplink());
            engine.RegisterUplink(new ContributorUplink("owner.lunch"));

            var ex = Assert.Throws<InvalidOperationException>(() => engine.Start());
            Assert.Contains("owner.lunch", ex.Message);
        }

        /// <summary>
        /// Registration order is not controllable across Uplinks, so a mod's
        /// Uplink may well register before the one declaring the command it
        /// constrains. The pairing is checked once, after all of them.
        /// </summary>
        [Fact]
        public void AContributionMayArriveBeforeTheCommandItConstrains()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var contributor = new ContributorUplink();
            contributor.Refuse.Add("built");
            engine.RegisterUplink(contributor);
            engine.RegisterUplink(new OwnerUplink());
            engine.Start();
            try
            {
                Assert.Equal(
                    GateOutcome.Fail,
                    engine.EvaluateGates(OwnedCommand, Args.With("shipName", "V-2")).Outcome);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// A command an installed mod has constrained is gated whether or not its
        /// owner declared anything, so it belongs on
        /// <c>system.uplink.gates</c>. Left off, a client would read it as a
        /// command with nothing to say about itself, which is a different claim
        /// from the one that is true.
        /// </summary>
        [Fact]
        public async Task ACommandGatedOnlyByAContributionStillReachesTheGateReport()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", executeCommandsOnMainThread: true);
            engine.RegisterUplink(new OwnerUplink(declareRequirement: false));
            engine.RegisterUplink(new ContributorUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.UplinkGatesTopic, Timeout);

                engine.SampleCommandGates();
                engine.TickAndWait(1.0, new KspSnapshot { Ut = 1.0 }, Timeout);

                var delivered = await ReceiveStreamDataAsync(client, Timeout);
                var payload = Assert.IsType<Dictionary<string, object?>>(delivered.Payload);
                var gates = Assert.IsType<List<object?>>(payload["gates"]);

                var entry = Assert.Single(
                    gates.Cast<Dictionary<string, object?>>(),
                    g => (string?)g["command"] == OwnedCommand);
                var verdict = Assert.IsType<Dictionary<string, object?>>(entry["verdict"]);

                // Abstain, because the contribution needs an argument nobody has
                // supplied. A client draws that live, never dark.
                Assert.Equal((double)(int)GateOutcome.Abstain, verdict["outcome"]);

                // The command nobody constrained is still absent, so the channel
                // keeps meaning "these commands have something to say".
                Assert.DoesNotContain(
                    gates.Cast<Dictionary<string, object?>>(),
                    g => (string?)g["command"] == UngatedCommand);
            }
            finally { engine.Stop(); }
        }
    }
}
