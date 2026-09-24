using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The availability exit of <see cref="ChannelEngine"/>'s command dispatch:
    /// an unknown command, or one whose owning uplink is Unavailable.
    ///
    /// <para>This exit used to fall silent, and silence here was indistinguishable
    /// from a command still in flight for EVERY consumer: the client's loss timer
    /// eventually rejected the promise as "signal-lost" (untrue, the link was
    /// fine), and the operator's queue could not call it a failure at all, because
    /// the exit returns before the pending bookkeeping so there was no entry to
    /// classify and the path had never been down. One throwing mapper marks its
    /// owning uplink Unavailable and from then on every command that uplink owns
    /// landed here, so a whole widget failed while the board showed a healthy
    /// link.</para>
    ///
    /// <para>The comms-loss exit is deliberately NOT covered here: honest silence
    /// during a blackout is correct, "lost"/"signal-lost" is the true statement
    /// there, and it has its own test in
    /// <see cref="CommsGateCommandTests"/>.</para>
    /// </summary>
    public class CommandRefusalTests
    {
        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
        private static readonly TimeSpan SettleWindow = TimeSpan.FromMilliseconds(300);

        [Fact]
        public void UnknownCommandIsRefusedRatherThanDroppedSilently()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RefusalTestUplink());
            engine.Start();
            try
            {
                object? result = null;
                var resolved = false;
                string? refusal = null;
                engine.DispatchCommandAndWait(
                    "nothing.registered.this", null, "vantage-1",
                    r => { resolved = true; result = r; },
                    SettleWindow,
                    onRefused: reason => refusal = reason);

                Assert.False(resolved, "an unknown command has no handler, so it must never produce a RESULT");
                Assert.Null(result);
                Assert.Equal(
                    "command \"nothing.registered.this\" is not recognised by this host",
                    refusal);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void CommandWhoseUplinkIsUnavailableIsRefusedCarryingThatUplinksOwnReason()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            // Declares itself unavailable in Register, the way an uplink whose mod
            // is simply absent does. This is the COMMON case in a normal install,
            // and the reason it gives is the whole operational value of the
            // refusal: it names what to go and look at.
            engine.RegisterUplink(new RefusalTestUplink(unavailableBecause: "test harness assembly not loaded"));
            engine.Start();
            try
            {
                var resolved = false;
                string? refusal = null;
                engine.DispatchCommandAndWait(
                    RefusalTestUplink.Command, "x", "vantage-1",
                    _ => resolved = true,
                    SettleWindow,
                    onRefused: reason => refusal = reason);

                Assert.False(resolved);
                Assert.NotNull(refusal);
                Assert.Contains(RefusalTestUplink.UplinkId, refusal);
                Assert.Contains("test harness assembly not loaded", refusal);
                // An absent mod has not "failed", and saying so would send an
                // operator hunting a fault that does not exist.
                Assert.DoesNotContain("has failed", refusal);
            }
            finally { engine.Stop(); }
        }

        [Fact]
        public void AnAvailableCommandStillResolvesAndIsNeverRefused()
        {
            // The negative: without this the suite would pass just as well if the
            // engine refused everything.
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RefusalTestUplink());
            engine.Start();
            try
            {
                object? result = null;
                string? refusal = null;
                engine.DispatchCommandAndWait(
                    RefusalTestUplink.Command, "ping", "vantage-1",
                    r => result = r,
                    SettleWindow,
                    onRefused: reason => refusal = reason);

                Assert.Null(refusal);
                Assert.Equal("pong:ping", result);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// A DECIDED gate refusal is a refusal, not a breakage.
        ///
        /// <para>It used to leave through the same callback the unavailable-uplink
        /// exit uses, which emits an <c>E_UNAVAILABLE</c> error frame. The client
        /// put that in phase <c>failed</c> and <c>classifyCommandRejection</c>
        /// reported "the machinery broke, a retry may work". Nothing had broken,
        /// and no number of retries moves a limit.</para>
        /// </summary>
        [Fact]
        public void AGateThatDecidedNoIsRefusedWithItsNumbersRatherThanReportedAsBroken()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new GatedTestUplink());
            engine.Start();
            try
            {
                object? result = null;
                string? refusal = null;
                engine.DispatchCommandAndWait(
                    GatedTestUplink.Command, "x", "vantage-1",
                    r => result = r,
                    SettleWindow,
                    onRefused: reason => refusal = reason);

                Assert.Null(refusal);
                var commandResult = Assert.IsAssignableFrom<CommandResult>(result);
                Assert.False(commandResult.Success);
                Assert.Equal(CommandErrorCode.LimitReached, commandResult.ErrorCode);
                // The arm alone cannot say "19.4 t over 18 t". Both, or neither.
                Assert.NotNull(commandResult.Breach);
                Assert.Equal("LaunchPad", commandResult.Breach!.Facility);
                Assert.Equal("Launch Pad", commandResult.Breach.FacilityName);
                Assert.Equal(18.0, commandResult.Breach.Limit);
                Assert.Equal(19.4, commandResult.Breach.Actual);
                Assert.Equal("t", commandResult.Breach.Unit);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// An evaluator that answers NOTHING is read as an evaluator that said
        /// yes, so the gate it was declared to hold authorises its command.
        ///
        /// <para><c>ChannelEngine.EvaluateGatesHere</c> coalesces a null verdict
        /// with <c>GateVerdict.Pass()</c>. Every neighbouring arm of the same
        /// method coalesces the identical null the opposite way, and the method
        /// states the rule in its own words a few lines above: an unevaluable
        /// gate must not read as no gate. Both surfaces that ask a gate anything
        /// run through this one method, so the advisory sampler publishes the
        /// control as live AND the dispatch that is supposed to re-check it lets
        /// the command through.</para>
        ///
        /// <para><b>This asserts the DEFECT, not the requirement.</b> It is
        /// green on today's tree and goes red the moment the coalesce is
        /// corrected, which is deliberate: the <c>mod</c> CI job is a hard gate
        /// with no exemption mechanism, so a plain red test would break the
        /// build for everyone until the operator has ruled on the fix. When the
        /// coalesce answers Unknown, this test wants the assertions its sibling
        /// below already makes: a null <c>result</c>, and a <c>refusal</c>
        /// naming the gate kind that returned nothing. Rename it then.</para>
        /// </summary>
        [Fact]
        public void AnEvaluatorThatAnswersNothingStillAuthorisesTheCommand()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new GatedTestUplink(answersNothing: true));
            engine.Start();
            try
            {
                object? result = null;
                string? refusal = null;
                engine.DispatchCommandAndWait(
                    GatedTestUplink.Command, "x", "vantage-1",
                    r => result = r,
                    SettleWindow,
                    onRefused: reason => refusal = reason);

                Assert.True(
                    result is string,
                    "the gate no longer authorises a command whose evaluator answered nothing, so the "
                        + "defect this test pins is fixed: invert it to assert the refusal and rename it");
                Assert.Null(refusal);
                Assert.Equal("lifted:x", result);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// The other half of the split: a gate that could not decide is still an
        /// error frame. Abstain and Unknown mean a bad declaration or unreadable
        /// live state, which IS the machinery-broke class, and the prose naming
        /// the cause is the whole value of them.
        /// </summary>
        [Fact]
        public void AGateThatCouldNotDecideStaysAnErrorFrameWithItsProse()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new GatedTestUplink(undecidable: true));
            engine.Start();
            try
            {
                object? result = null;
                string? refusal = null;
                engine.DispatchCommandAndWait(
                    GatedTestUplink.Command, "x", "vantage-1",
                    r => result = r,
                    SettleWindow,
                    onRefused: reason => refusal = reason);

                Assert.Null(result);
                Assert.NotNull(refusal);
                Assert.Contains("the scales are down", refusal);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// The seam, C# half: a real <c>ClientWebSocket</c> asks for a command
        /// whose uplink is unavailable and reads what actually comes back off the
        /// wire, then writes that frame to the committed fixture the TS half
        /// consumes (<c>command-refusal.wire.json</c>) and asserts the committed
        /// copy still matches.
        ///
        /// <para>Regenerate-and-assert is what makes the fixture a JOINT rather
        /// than a second assumption: a committed fixture nobody re-derives is a
        /// stale expectation with extra steps. If the engine's frame changes, this
        /// test fails until the fixture is regenerated, and the TS test then fails
        /// if the client cannot handle the new shape.</para>
        /// </summary>
        [Fact]
        public async Task RefusedCommandArrivesAtTheClientAsAnUnavailableErrorFrame()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new RefusalTestUplink(unavailableBecause: "test harness assembly not loaded"));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);

                await client.SendAsync(EnvelopeCodec.WriteCommandRequest(new CommandRequest<object?>
                {
                    Type = "command-request",
                    RequestId = "r-refused",
                    Command = RefusalTestUplink.Command,
                    Args = "x",
                    SentAt = 0.0,
                }));

                // Without the guard, nothing would ever be sent for this
                // request and this would time out.
                var error = await ReceiveTypedAsync<ErrorMsg>(client, Timeout);

                Assert.Equal("error", error.Type);
                Assert.Equal("r-refused", error.RequestId);
                Assert.Equal("E_UNAVAILABLE", error.Code);
                Assert.Contains(RefusalTestUplink.UplinkId, error.Message);
                Assert.Contains("test harness assembly not loaded", error.Message);

                var frame = EnvelopeCodec.WriteErrorMsg(error);
                var path = FixturePath("command-refusal.wire.json");
                var committed = File.Exists(path) ? File.ReadAllText(path) : null;
                if (committed != frame)
                {
                    File.WriteAllText(path, frame);
                }
                Assert.Equal(frame, committed);
            }
            finally { engine.Stop(); }
        }

        /// <summary>
        /// The committed fixture lives beside the TS test that consumes it, so the
        /// two cannot drift apart by living in different trees. Walks up from the
        /// test assembly rather than assuming a working directory.
        ///
        /// <para>The <c>.wire.json</c> suffix is load-bearing: biome is told to
        /// leave <c>__fixtures__/*.wire.json</c> alone, because this file is
        /// RECORDED BYTES rather than source. Pretty-printing it would change the
        /// text while leaving it valid JSON, and the byte comparison below, which
        /// is the whole point of the fixture, would then fail for a formatting
        /// reason that looks like an engine change.</para>
        /// </summary>
        private static string FixturePath(string fileName)
        {
            var dir = AppContext.BaseDirectory;
            while (dir != null && !Directory.Exists(Path.Combine(dir, "packages")))
            {
                dir = Path.GetDirectoryName(dir);
            }
            if (dir == null) throw new InvalidOperationException("could not locate the repo root from " + AppContext.BaseDirectory);
            var fixtures = Path.Combine(dir, "packages", "sitrep-client", "src", "__fixtures__");
            Directory.CreateDirectory(fixtures);
            return Path.Combine(fixtures, fileName);
        }

        /// <summary>
        /// A command that declares a gate, plus the evaluator that answers it.
        /// The evaluator decides no with numbers, or cannot decide at all, which
        /// are the two sides of the split under test, or answers nothing, which
        /// is neither and is the third case the host has to have an answer for.
        /// </summary>
        private sealed class GatedTestUplink : ISitrepUplink
        {
            public const string UplinkId = "test-gated";
            public const string Command = "gated.launch";
            public const string GateKind = "test-pad-mass";

            private readonly bool _undecidable;
            private readonly bool _answersNothing;

            public GatedTestUplink(bool undecidable = false, bool answersNothing = false)
            {
                _undecidable = undecidable;
                _answersNothing = answersNothing;
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    new CommandDeclaration
                    {
                        Command = Command,
                        Delay = DelayRole.TrueNow,
                        Requires = new[]
                        {
                            new CommandRequirement { Kind = GateKind, Facility = "LaunchPad", Quantity = "mass" },
                        },
                    },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>(Command, args => "lifted:" + args);
                host.AddGateEvaluator(new Evaluator(_undecidable, _answersNothing));
            }

            private sealed class Evaluator : ICommandGateEvaluator
            {
                private readonly bool _undecidable;
                private readonly bool _answersNothing;

                public Evaluator(bool undecidable, bool answersNothing)
                {
                    _undecidable = undecidable;
                    _answersNothing = answersNothing;
                }

                public string Kind => GateKind;

                public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
                {
                    // A third-party Uplink compiles against its own copy of the
                    // contract and may have nullable reference types off
                    // entirely, so the annotation on this signature constrains
                    // nobody and the host receives the null regardless. null!
                    // is how that arrives here without the suppression becoming
                    // the thing under test.
                    if (_answersNothing) return null!;

                    return _undecidable
                        ? GateVerdict.Unknown("the scales are down")
                        : GateVerdict.Fail(new LimitBreach
                        {
                            Facility = "LaunchPad",
                            FacilityName = "Launch Pad",
                            FacilityLevel = 1.0,
                            Quantity = "mass",
                            Limit = 18.0,
                            Actual = 19.4,
                            Unit = "t",
                        });
                }
            }
        }

        private sealed class RefusalTestUplink : ISitrepUplink
        {
            public const string UplinkId = "test-refusal";
            public const string Command = "refusal.ping";

            private readonly string? _unavailableBecause;

            public RefusalTestUplink(string? unavailableBecause = null)
            {
                _unavailableBecause = unavailableBecause;
            }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = UplinkId,
                Version = "1.0.0",
                Commands = new List<CommandDeclaration>
                {
                    // delayed:false so an AVAILABLE dispatch resolves on the same
                    // job step: this suite is about the availability exit, not
                    // about the courier's clock.
                    new CommandDeclaration { Command = Command, Delay = DelayRole.TrueNow },
                },
            };

            public void Register(IUplinkHost host)
            {
                host.AddCommandHandler<string, string>(Command, args => "pong:" + args);
                if (_unavailableBecause != null)
                {
                    host.SetAvailability(Availability.Unavailable(_unavailableBecause));
                }
            }
        }
    }
}
