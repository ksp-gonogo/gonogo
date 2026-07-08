using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Foundation tests for <see cref="UplinkDiscovery"/> — the kOS
    /// <c>AddonManager</c> precedent adapted for Uplinks (see
    /// <see cref="UplinkDiscovery"/>'s own doc comment). Uses the
    /// assembly-set overload (<see cref="UplinkDiscovery.Discover(IEnumerable{System.Reflection.Assembly})"/>)
    /// rather than the AppDomain-wide one so each test controls exactly
    /// which types are visible to the scan.
    /// </summary>
    public class UplinkDiscoveryTests
    {
        private static readonly System.Reflection.Assembly[] ThisAssembly =
            { typeof(UplinkDiscoveryTests).Assembly };

        [Fact]
        public void DiscoversAttributedUplinkWithParameterlessConstructor()
        {
            var found = UplinkDiscovery.Discover(ThisAssembly);

            var match = found.SingleOrDefault(d => d.Uplink.Manifest.Id == "discovery-test-normal");
            Assert.NotEqual(default, match);
            Assert.IsType<NormalDiscoverableUplink>(match.Uplink);
            Assert.Equal(ContractVersion.Major, match.ContractMajor);
            Assert.Equal(ContractVersion.Minor, match.ContractMinor);
        }

        [Fact]
        public void SkipsTypeWithNoSitrepUplinkAttribute()
        {
            var found = UplinkDiscovery.Discover(ThisAssembly);

            Assert.DoesNotContain(found, d => d.Uplink is UnattributedUplink);
        }

        [Fact]
        public void SkipsTypeWithNoParameterlessConstructorWithoutThrowing()
        {
            // NoParameterlessCtorUplink carries [SitrepUplink] but only a
            // one-arg constructor — discovery must skip it (log + continue),
            // never throw, and every OTHER attributed type in the same scan
            // must still be found.
            var found = UplinkDiscovery.Discover(ThisAssembly);

            Assert.DoesNotContain(found, d => d.Uplink is NoParameterlessCtorUplink);
            Assert.Contains(found, d => d.Uplink.Manifest.Id == "discovery-test-normal");
        }

        [Fact]
        public void SkipsConstructorThatThrowsWithoutThrowing()
        {
            // ThrowingCtorUplink's constructor throws -- discovery must
            // catch it, skip that one Uplink, and keep scanning/returning
            // every other attributed type in the same assembly (the
            // per-Uplink fail-soft applies even at DISCOVERY time, before
            // ChannelEngine.RegisterUplink ever gets a chance to fail-soft
            // its Register() call).
            var found = UplinkDiscovery.Discover(ThisAssembly);

            Assert.DoesNotContain(found, d => d.Uplink is ThrowingCtorUplink);
            Assert.Contains(found, d => d.Uplink.Manifest.Id == "discovery-test-normal");
        }

        [Fact]
        public void ExplicitContractVersionOverrideIsHonored()
        {
            // StaleContractUplink declares an explicit OLD contract version
            // via its [SitrepUplink] attribute arguments -- simulating a
            // binary compiled against an earlier ContractVersion.Major that
            // was never recompiled (see SitrepUplinkAttribute's doc comment
            // on why the default-parameter mechanism captures this for real
            // stale binaries; this test exercises the explicit-override path
            // directly rather than needing an actual old assembly on disk).
            var found = UplinkDiscovery.Discover(ThisAssembly);

            var stale = found.Single(d => d.Uplink.Manifest.Id == "discovery-test-stale");
            Assert.Equal(0, stale.ContractMajor);
            Assert.Equal(9, stale.ContractMinor);
        }

        [Fact]
        public void RegisterDiscoveredUplinkFailsSoftOnMajorMismatchWithoutCallingRegister()
        {
            // RegisterUplink/RegisterDiscoveredUplink must run BEFORE
            // Start() (see ChannelEngine.RegisterUplink's own doc comment),
            // so this engine is deliberately never started — Dispose() on an
            // unstarted engine would otherwise throw ThreadStateException
            // trying to Join a Thread that was never Start()ed, unrelated to
            // what this test actually exercises. No Stop()/Dispose() needed:
            // an unstarted engine holds no thread/socket to release.
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new NormalDiscoverableUplink();

            engine.RegisterDiscoveredUplink(uplink, contractMajor: ContractVersion.Major + 1, contractMinor: 0);

            Assert.False(uplink.RegisterWasCalled);
            var availability = engine.AvailabilityOf(uplink.Manifest.Id);
            Assert.False(availability.IsAvailable);
            Assert.Contains("major mismatch", availability.Reason);
        }

        [Fact]
        public void RegisterDiscoveredUplinkSucceedsOnMatchingMajor()
        {
            // See the no-Start()/no-Dispose() rationale in the sibling test above.
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new NormalDiscoverableUplink();

            engine.RegisterDiscoveredUplink(uplink, contractMajor: ContractVersion.Major, contractMinor: ContractVersion.Minor + 5);

            Assert.True(uplink.RegisterWasCalled);
            Assert.True(engine.AvailabilityOf(uplink.Manifest.Id).IsAvailable);
        }

        // ---- fixtures ----------------------------------------------------

        [SitrepUplink("discovery-test-normal")]
        public sealed class NormalDiscoverableUplink : ISitrepUplink
        {
            public bool RegisterWasCalled { get; private set; }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "discovery-test-normal",
                Version = "1.0.0",
                Channels = Array.Empty<ChannelDeclaration>(),
                Commands = Array.Empty<CommandDeclaration>(),
            };

            public void Register(IUplinkHost host) => RegisterWasCalled = true;
        }

        public sealed class UnattributedUplink : ISitrepUplink
        {
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-unattributed" };
            public void Register(IUplinkHost host) { }
        }

        [SitrepUplink("discovery-test-no-parameterless-ctor")]
        public sealed class NoParameterlessCtorUplink : ISitrepUplink
        {
            public NoParameterlessCtorUplink(string _) { }
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-no-parameterless-ctor" };
            public void Register(IUplinkHost host) { }
        }

        [SitrepUplink("discovery-test-throwing-ctor")]
        public sealed class ThrowingCtorUplink : ISitrepUplink
        {
            public ThrowingCtorUplink() => throw new InvalidOperationException("boom");
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-throwing-ctor" };
            public void Register(IUplinkHost host) { }
        }

        [SitrepUplink("discovery-test-stale", contractMajor: 0, contractMinor: 9)]
        public sealed class StaleContractUplink : ISitrepUplink
        {
            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = "discovery-test-stale" };
            public void Register(IUplinkHost host) { }
        }
    }
}
