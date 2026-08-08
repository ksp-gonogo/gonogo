using System.Linq;
using Gonogo.MechJebUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoMechJebUplink.Tests
{
    /// <summary>
    /// Headless tests for the MechJeb2-free half of <see cref="MechJebUplink"/>:
    /// the manifest shape, the mandatory <see cref="ISitrepUplink.Health"/>
    /// self-report, and that <see cref="MechJebUplink.Register"/> is a safe
    /// no-op when the MechJeb2-touching half (<c>MechJebUplink.Ksp.cs</c>) is
    /// not part of the compilation, exactly the shape a headless CI build
    /// sees. The actual version-guard probe + engage calls
    /// (<c>MechJebController</c>) are MechJeb2/Unity-touching and covered by
    /// <see cref="MechJebVersionGuardTests"/> (pure logic, fake types) and a
    /// Deck live-verify pass respectively, see the class doc comments on
    /// <c>MechJebUplink.cs</c> / <c>MechJebController.cs</c>.
    /// </summary>
    public class MechJebUplinkTests
    {
        [Fact]
        public void Manifest_DeclaresExactlyTheThreeDelayedCommands_NoChannels()
        {
            var uplink = new MechJebUplink();

            Assert.Equal("mechjeb", uplink.Manifest.Id);
            Assert.Empty(uplink.Manifest.Channels);

            var commands = uplink.Manifest.Commands;
            Assert.Equal(3, commands.Count);
            Assert.All(commands, c => Assert.True(c.Delayed, $"{c.Command} should be Delayed (a genuine signal to the craft)"));

            var names = commands.Select(c => c.Command).ToList();
            Assert.Contains(MechJebChannels.EngageAscentAutopilotCommand, names);
            Assert.Contains(MechJebChannels.ExecuteNextNodeCommand, names);
            Assert.Contains(MechJebChannels.LandAtTargetCommand, names);
        }

        [Fact]
        public void Health_DefaultsToHealthy()
        {
            var uplink = new MechJebUplink();

            var health = uplink.Health();

            Assert.Equal(UplinkHealthState.Healthy, health.State);
        }

        [Fact]
        public void Health_ReportsUnavailable_WhenVersionGuardWentInert()
        {
            var uplink = new MechJebUplink
            {
                // Simulates what RegisterMechJebBindings (MechJebUplink.Ksp.cs)
                // sets when MechJebVersionGuard.Probe fails: MechJeb2 absent or
                // its API drifted. Field is internal exactly so this headless
                // test can drive Health() into its Unavailable state without
                // a real MechJeb2 assembly, see the field's doc comment.
                _unavailableReason = "MechJeb2.dll not loaded",
            };

            var health = uplink.Health();

            Assert.Equal(UplinkHealthState.Unavailable, health.State);
            Assert.Equal("MechJeb2.dll not loaded", health.Detail);
        }

        [Fact]
        public void Register_WithNoKspHalfCompiled_IsASafeNoOp()
        {
            // RegisterMechJebBindings has no implementing declaration in this
            // headless test build (MechJebUplink.Ksp.cs is excluded, see
            // GonogoMechJebUplink.Tests.csproj), so the partial-method call
            // compiles away to nothing: the standard C# optional-partial-
            // method behaviour this Uplink relies on to stay
            // discovery-compatible (UplinkDiscovery needs a fully-implemented
            // ISitrepUplink) without ever touching MechJeb2/Unity from a
            // headless build. This just proves Register() never throws.
            var uplink = new MechJebUplink();

            var ex = Record.Exception(() => uplink.Register(new NullUplinkHost()));

            Assert.Null(ex);
        }
    }
}
