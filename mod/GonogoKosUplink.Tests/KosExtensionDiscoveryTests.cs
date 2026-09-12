using System;
using System.Collections.Generic;
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

        /// <summary>
        /// Every kOS command rides the signal delay, resize included, and the
        /// manifest is not where that is said.
        ///
        /// <para>Resize was the one exception until the command classification
        /// was settled: a terminal is a cursor-addressed screen diff computed at
        /// the mod's width, so a delayed resize leaves the mod diffing at the old
        /// width for a light-time round trip and the client draws those diffs at
        /// the wrong column until the new width lands. That is a real cost and it
        /// is the lesser one. Instant, a resize let one console reflow a terminal
        /// another console was reading in real time, and a resize is an order like
        /// any other: it changes no scene and it is not a presentation choice,
        /// which is the whole of the rule for an instant command.</para>
        ///
        /// <para>Read off the <c>[SitrepCommand]</c> rather than the manifest
        /// because that is the declaration the SDK codegen hands the client, so
        /// this is the same fact a console's countdown is drawn from.</para>
        /// </summary>
        [Fact]
        public void EveryCommandIsTaggedDelayedInTheContract()
        {
            var tagged = new Dictionary<string, bool>(StringComparer.Ordinal);
            foreach (var type in typeof(KosTerminalResizeArgs).Assembly.GetTypes())
            {
                foreach (SitrepCommandAttribute attr in
                         type.GetCustomAttributes(typeof(SitrepCommandAttribute), false))
                {
                    tagged[attr.CommandId] = attr.Delayed;
                }
            }

            var manifest = UplinkDiscovery
                .Discover(new[] { typeof(KosExtension).Assembly })
                .Single(d => d.Uplink.Manifest.Id == "kos")
                .Uplink.Manifest;

            var declared = manifest.Commands.Select(c => c.Command).ToArray();
            Assert.NotEmpty(declared);
            Assert.Empty(declared.Where(id => !tagged.ContainsKey(id)));
            Assert.Empty(declared.Where(id => !tagged[id]));

            Assert.True(tagged[KosChannels.TerminalResizeCommand]);
            Assert.True(tagged[KosChannels.KeystrokeCommand]);
        }
    }
}
