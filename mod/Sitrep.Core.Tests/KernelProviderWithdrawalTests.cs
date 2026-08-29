using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A provider that cannot serve a capability on THIS install withdraws from
    /// the election rather than winning it and answering nothing.
    ///
    /// <para>The live case: a life-support mod registers for the exclusive
    /// <c>"reliability"</c> capability, and the player has that mod's failure
    /// modelling switched off. It has nothing to model, but an exclusive
    /// capability is held by exactly one provider, so while it holds it every
    /// other backend that COULD model reliability is starved.</para>
    ///
    /// <para><b>Why withdrawal and not a factory decline.</b> A factory runs after
    /// the winner has been chosen, so declining there falls through to VANILLA and
    /// the runner-up never gets a look in: the capability ends up unserved because
    /// the provider that could not serve it got there first. Withdrawing before
    /// selection means relative priority stops mattering, which is the whole point,
    /// and is what the two tests below pin from both directions.</para>
    /// </summary>
    public class KernelProviderWithdrawalTests
    {
        private sealed class Backend
        {
            public string Name = "";
        }

        private static ResolveOptions Opts() => new ResolveOptions { KernelVersion = "1.0.0" };

        private static Kernel WithCapability()
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = "reliability",
                Exclusive = true,
                Vanilla = _ => new Backend { Name = "none" },
            });
            return kernel;
        }

        /// <summary>
        /// The requirement in its hardest form: the withdrawing provider outranks
        /// the one that can serve, and the one that can serve STILL wins. If
        /// withdrawal happened any later than selection this would resolve to the
        /// vanilla backend instead, which is the bug being fixed.
        /// </summary>
        [Fact]
        public void ARunnerUpWinsOutrightWhenAHigherPriorityProviderWithdraws()
        {
            var kernel = WithCapability();
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "reliability",
                Id = "lifesupport",
                Priority = 10.0,
                CanServe = () => false,
                Factory = _ => new Backend { Name = "lifesupport" },
            });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "reliability",
                Id = "wearmodel",
                Priority = 1.0,
                Factory = _ => new Backend { Name = "wearmodel" },
            });

            var result = kernel.Resolve(Opts());

            Assert.Equal("wearmodel", kernel.Query<Backend>("reliability").Name);
            Assert.Contains(result.Notices,
                n => n.Capability == "reliability" && n.Kind == "provider-declined");
            // Not a supersede: nothing beat it, it stood down before the contest.
            Assert.DoesNotContain(result.Notices,
                n => n.Kind == "superseded" && n.Detail.Contains("lifesupport"));
            // And emphatically not the vanilla floor.
            Assert.DoesNotContain(result.Notices,
                n => n.Capability == "reliability" && n.Kind == "vanilla-fallback");
        }

        /// <summary>
        /// The same withdrawal with nothing else registered still reaches vanilla,
        /// so withdrawing cannot leave an exclusive capability unsatisfied.
        /// </summary>
        [Fact]
        public void WithdrawingWithNoOtherProviderFallsBackToVanilla()
        {
            var kernel = WithCapability();
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "reliability",
                Id = "lifesupport",
                CanServe = () => false,
                Factory = _ => new Backend { Name = "lifesupport" },
            });

            var result = kernel.Resolve(Opts());

            Assert.Equal("none", kernel.Query<Backend>("reliability").Name);
            Assert.Contains(result.Notices,
                n => n.Capability == "reliability" && n.Kind == "provider-declined");
        }

        /// <summary>
        /// A provider that can serve is untouched, and the absence of a predicate
        /// means "always able" so every existing registration keeps its behaviour.
        /// </summary>
        [Fact]
        public void AProviderThatCanServeIsUnaffected()
        {
            var kernel = WithCapability();
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "reliability",
                Id = "lifesupport",
                CanServe = () => true,
                Factory = _ => new Backend { Name = "lifesupport" },
            });

            var result = kernel.Resolve(Opts());

            Assert.Equal("lifesupport", kernel.Query<Backend>("reliability").Name);
            Assert.DoesNotContain(result.Notices, n => n.Kind == "provider-declined");
        }

        /// <summary>
        /// The predicate is asked during RESOLVE, not at registration. A mod
        /// registers while the game is still loading, when its own settings may not
        /// be parsed, so a decision taken at registration would pin whatever
        /// happened to be true that early and never revisit it.
        /// </summary>
        [Fact]
        public void ThePredicateIsAskedAtResolveNotAtRegistration()
        {
            var kernel = WithCapability();
            var settingsReadable = false;
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "reliability",
                Id = "lifesupport",
                CanServe = () => settingsReadable,
                Factory = _ => new Backend { Name = "lifesupport" },
            });

            // Registration happened while the answer was still false; by the time
            // the capability resolves, the setting is readable and says yes.
            settingsReadable = true;
            kernel.Resolve(Opts());

            Assert.Equal("lifesupport", kernel.Query<Backend>("reliability").Name);
        }
    }
}
