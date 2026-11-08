using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class SaveGuardsTests
    {
        private sealed class FakeGuard : ISaveGuard
        {
            private readonly Func<bool> _forbids;

            public FakeGuard(Func<bool> forbids)
            {
                _forbids = forbids;
            }

            public string ProviderId => "fake";

            public bool ForbidsSaving => _forbids();
        }

        private static Kernel WithGuards(params Func<bool>[] guards)
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor { Id = SaveGuardCapability.Id, Exclusive = false });
            var index = 0;
            foreach (var guard in guards)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = SaveGuardCapability.Id,
                    Id = "guard" + index++,
                    Factory = _ => new FakeGuard(guard),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });
            return kernel;
        }

        [Fact]
        public void WithNoGuardRegisteredSavingIsAllowed()
        {
            Assert.False(SaveGuards.AnyForbids(WithGuards()));
        }

        [Fact]
        public void OneGuardForbiddingIsEnough()
        {
            Assert.True(SaveGuards.AnyForbids(WithGuards(() => false, () => true)));
        }

        [Fact]
        public void AGuardFollowsTheStateItReads()
        {
            var simulating = false;
            var kernel = WithGuards(() => simulating);
            Assert.False(SaveGuards.AnyForbids(kernel));
            simulating = true;
            Assert.True(SaveGuards.AnyForbids(kernel));
        }

        [Fact]
        public void AGuardThatCannotAnswerForbids()
        {
            Assert.True(SaveGuards.AnyForbids(WithGuards(() => throw new InvalidOperationException())));
        }
    }
}
