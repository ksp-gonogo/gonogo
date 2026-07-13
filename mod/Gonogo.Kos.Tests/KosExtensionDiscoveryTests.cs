using System.Linq;
using System.Reflection;
using Gonogo.Kos;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Gonogo.Kos.Tests
{
    /// <summary>
    /// Guards the regression the Uplink-foundation review caught: without
    /// <c>[SitrepUplink("kos")]</c> and a parameterless constructor,
    /// <see cref="UplinkDiscovery"/>'s assembly scan silently skips
    /// <see cref="KosExtension"/> and the whole uplink is inert dead code
    /// in a live game. These assertions touch only the attribute + ctor
    /// metadata and the reflection scan — never <see cref="KosExtension.Register"/>
    /// or the Unity GameObject path — so they run headlessly.
    /// </summary>
    public class KosExtensionDiscoveryTests
    {
        [Fact]
        public void KosExtension_CarriesSitrepUplinkAttribute_WithKosId()
        {
            var attr = typeof(KosExtension).GetCustomAttribute<SitrepUplinkAttribute>();

            Assert.NotNull(attr);
            Assert.Equal("kos", attr!.Id);
        }

        [Fact]
        public void KosExtension_HasPublicParameterlessConstructor()
        {
            var ctor = typeof(KosExtension).GetConstructor(System.Type.EmptyTypes);

            Assert.NotNull(ctor);
            Assert.True(ctor!.IsPublic);
        }

        [Fact]
        public void Discover_FindsKosUplink_InGonogoKosAssembly()
        {
            var discovered = UplinkDiscovery.Discover(new[] { typeof(KosExtension).Assembly });

            Assert.Contains(discovered, d => d.Uplink.Manifest.Id == "kos");
        }

        [Fact]
        public void TerminalResizeCommand_IsNotDelayed_SoRenderWidthConvergesImmediately()
        {
            // The terminal downlink is a cursor-addressed screen diff computed at
            // the mod's screen width; a delayed resize leaves the mod diffing at a
            // stale width for a full light-time round-trip, so the client renders
            // those diffs at the wrong column and the terminal reads as garbled.
            // Resize is a local viewport concern, so it must reach the mod
            // immediately — unlike a keystroke, which is genuine remote input.
            var manifest = UplinkDiscovery
                .Discover(new[] { typeof(KosExtension).Assembly })
                .Single(d => d.Uplink.Manifest.Id == "kos")
                .Uplink.Manifest;

            var resize = manifest.Commands.Single(c => c.Command == KosChannels.TerminalResizeCommand);
            Assert.False(resize.Delayed);

            var keystroke = manifest.Commands.Single(c => c.Command == KosChannels.KeystrokeCommand);
            Assert.True(keystroke.Delayed);
        }
    }
}
