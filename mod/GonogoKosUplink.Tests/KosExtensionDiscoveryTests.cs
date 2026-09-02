using System.Linq;
using System.Reflection;
using Gonogo.KosUplink;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace GonogoKosUplink.Tests
{
    /// <summary>
    /// Guards the regression the Uplink-foundation review caught: without
    /// <c>[SitrepUplink("kos")]</c> and a parameterless constructor,
    /// <see cref="UplinkDiscovery"/>'s assembly scan silently skips
    /// <see cref="KosExtension"/> and the whole uplink is inert dead code
    /// in a live game. These assertions touch only the attribute + ctor
    /// metadata and the reflection scan: never <see cref="KosExtension.Register"/>
    /// or the Unity GameObject path: so they run headlessly.
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
        public void Manifest_ExpectedClientHash_MirrorsTheGeneratedConst()
        {
            /*
             * The manifest must surface whatever ExpectedClientHash.g.cs holds, and the
             * mapping either way is the invariant: an empty const reports null, so the
             * loader degrades to the two-way index==bytes check with the mod-hash arm
             * pending; a filled one reports the hash, so the loader can enforce the
             * three-way agreement.
             *
             * This asserted the null half alone until 2026-09-02, on the premise that the
             * const is only filled at release build. That premise no longer holds: kOS is
             * armed and its hash is COMMITTED, deliberately, so the parity test can fail on
             * the first byte of drift. A test pinned to the unarmed state failed the moment
             * arming landed, having described a transient condition as a rule.
             */
            var manifest = UplinkDiscovery
                .Discover(new[] { typeof(KosExtension).Assembly })
                .Single(d => d.Uplink.Manifest.Id == "kos")
                .Uplink.Manifest;

            var expected = string.IsNullOrEmpty(ExpectedClientHash.Value)
                ? null
                : ExpectedClientHash.Value;

            Assert.Equal(expected, manifest.ExpectedClientHash);
        }

        [Fact]
        public void TerminalResizeCommand_IsNotDelayed_SoRenderWidthConvergesImmediately()
        {
            // The terminal downlink is a cursor-addressed screen diff computed at
            // the mod's screen width; a delayed resize leaves the mod diffing at a
            // stale width for a full light-time round-trip, so the client renders
            // those diffs at the wrong column and the terminal reads as garbled.
            // Resize is a local viewport concern, so it must reach the mod
            // immediately: unlike a keystroke, which is genuine remote input.
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
