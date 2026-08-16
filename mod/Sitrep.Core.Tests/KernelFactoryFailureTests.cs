using System;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A provider can win its election and still be unable to run. The live
    /// case: RealAntennas registers for the exclusive <c>"comms"</c>
    /// capability and wins, then its backend type fails vtable setup because
    /// the deployed assembly predates a contract change, so the factory
    /// throws at activation. Selection has already declared it the winner by
    /// then, so nothing downstream reconsiders.
    ///
    /// <para>Before this, that throw propagated out of <c>Resolve</c>: the
    /// capability activated no instance at all, CommNet (its vanilla
    /// fallback, and the whole reason the capability is documented as never
    /// unsatisfiable) never ran, and every capability later in the
    /// activation order was skipped. In-game that read as six silent
    /// <c>comms.*</c> channels plus no signal-delay authority, with no error
    /// anywhere near the comms code.</para>
    ///
    /// <para>The golden-fixture conformance test covers agreement with the TS
    /// kernel on scripted scenarios; factories that throw cannot be expressed
    /// in that JSON, so this behaviour is pinned here and mirrored in
    /// <c>registry.test.ts</c>.</para>
    /// </summary>
    public class KernelFactoryFailureTests
    {
        private sealed class Backend
        {
            public string Name = "";
        }

        private static ResolveOptions Opts() => new ResolveOptions { KernelVersion = "1.0.0" };

        [Fact]
        public void ExclusiveWinnerThatThrowsFallsBackToVanilla()
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = "comms",
                Exclusive = true,
                Vanilla = _ => new Backend { Name = "commnet" },
            });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "comms",
                Id = "realantennas",
                Factory = _ => throw new TypeLoadException("VTable setup of type RaCommsBackend failed"),
            });

            var result = kernel.Resolve(Opts());

            Assert.Equal("commnet", kernel.Query<Backend>("comms").Name);
            Assert.Contains(result.Notices, n => n.Capability == "comms" && n.Kind == "factory-failed");
            Assert.Contains(result.Notices, n => n.Capability == "comms" && n.Kind == "vanilla-fallback");
        }

        [Fact]
        public void FailedProviderIsNamedInItsNotice()
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = "comms",
                Exclusive = true,
                Vanilla = _ => new Backend { Name = "commnet" },
            });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "comms",
                Id = "realantennas",
                Factory = _ => throw new TypeLoadException("VTable setup of type RaCommsBackend failed"),
            });

            var notice = kernel.Resolve(Opts()).Notices.Single(n => n.Kind == "factory-failed");

            Assert.Contains("realantennas", notice.Detail);
            Assert.Contains("VTable setup", notice.Detail);
        }

        [Fact]
        public void SharedCapabilityKeepsTheProvidersThatDidActivate()
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor { Id = "sensors", Exclusive = false });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "sensors",
                Id = "broken",
                Factory = _ => throw new InvalidOperationException("nope"),
            });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "sensors",
                Id = "working",
                Factory = _ => new Backend { Name = "working" },
            });

            var result = kernel.Resolve(Opts());

            var active = kernel.Active("sensors").Cast<Backend>().ToList();
            Assert.Equal(new[] { "working" }, active.Select(b => b.Name));
            Assert.Contains(result.Notices, n => n.Capability == "sensors" && n.Kind == "factory-failed");
        }

        [Fact]
        public void LaterCapabilitiesStillResolveAfterAnEarlierFactoryThrows()
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor { Id = "comms", Exclusive = true });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "comms",
                Id = "broken",
                Factory = _ => throw new InvalidOperationException("nope"),
            });
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = "science",
                Exclusive = true,
                Vanilla = _ => new Backend { Name = "stock-science" },
            });

            kernel.Resolve(Opts());

            Assert.Empty(kernel.Active("comms"));
            Assert.Equal("stock-science", kernel.Query<Backend>("science").Name);
        }
    }
}
