using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
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

                // Pre-fix this timed out: nothing was ever sent for this request.
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
                    new CommandDeclaration { Command = Command, Delayed = false },
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
