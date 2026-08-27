using System;
using System.Collections.Generic;
using Gonogo.KSP.CurrencyDelay;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// The core's fan-out to the arms that keep a DERIVED currency withheld.
    ///
    /// <para>The defect this closes is not RP-1's: it is the shape of every
    /// quantity a mod computes from a currency change. The core neutralises the
    /// change with a balance write, a balance write fires no currency query, so the
    /// mod is never told to revisit what it derived. Confidence was the instance
    /// that was measured (rig run <c>conf-leak-1</c>, 2026-08-27) and there is
    /// nothing special about it.</para>
    /// </summary>
    public class DerivedCurrencyWithholdingTests : IDisposable
    {
        public DerivedCurrencyWithholdingTests()
        {
            DerivedCurrencyWithholding.Unbind();
            DerivedCurrencyWithholding.Report = _ => { };
        }

        public void Dispose()
        {
            DerivedCurrencyWithholding.Unbind();
            DerivedCurrencyWithholding.Report = _ => { };
        }

        private static Kernel KernelWith(params IDerivedCurrencyWithholder[] arms)
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = DerivedCurrencyCapability.CapabilityId,
                Exclusive = false,
                SpineCritical = false,
            });
            var index = 0;
            foreach (var arm in arms)
            {
                var captured = arm;
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = DerivedCurrencyCapability.CapabilityId,
                    Id = "arm-" + index++,
                    Factory = _ => captured,
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });
            return kernel;
        }

        /// <summary>
        /// Shared, not exclusive, and this is the case that says why: two installed
        /// mods can each derive something from the same change, and every one of
        /// them has to be told or the one that is not told keeps leaking.
        /// </summary>
        [Fact]
        public void every_registered_arm_is_told_about_a_neutralise()
        {
            var first = new RecordingArm("first");
            var second = new RecordingArm("second");
            DerivedCurrencyWithholding.Bind(KernelWith(first, second));

            DerivedCurrencyWithholding.ObserveBeforeDerivation(DerivedCurrencyCapability.Science, 100.0);
            DerivedCurrencyWithholding.WithholdDerived(DerivedCurrencyCapability.Science, 25.0, 100.0);

            Assert.Equal(new[] { "observe science @100", "withhold science 25 @100" }, first.Calls);
            Assert.Equal(new[] { "observe science @100", "withhold science 25 @100" }, second.Calls);
        }

        /// <summary>
        /// A stock install declares the capability and registers no provider, so the
        /// fan-out has to be a no-op rather than a throw or a vanilla. There is
        /// deliberately no vanilla factory: nothing derives anything on a stock
        /// install, and a fallback would be a fallback to nothing.
        /// </summary>
        [Fact]
        public void an_install_with_no_arms_is_a_no_op()
        {
            DerivedCurrencyWithholding.Bind(KernelWith());

            DerivedCurrencyWithholding.ObserveBeforeDerivation(DerivedCurrencyCapability.Science, 100.0);
            DerivedCurrencyWithholding.WithholdDerived(DerivedCurrencyCapability.Science, 25.0, 100.0);
        }

        /// <summary>
        /// No kernel bound at all is the state between scene loads, and the
        /// interceptor still runs there. It must not throw.
        /// </summary>
        [Fact]
        public void nothing_bound_is_a_no_op()
        {
            Assert.False(DerivedCurrencyWithholding.Bound);

            DerivedCurrencyWithholding.ObserveBeforeDerivation(DerivedCurrencyCapability.Science, 100.0);
            DerivedCurrencyWithholding.WithholdDerived(DerivedCurrencyCapability.Science, 25.0, 100.0);
        }

        /// <summary>
        /// A kernel that never had the capability declared throws out of
        /// <c>Active</c>. The currency-delay subsystem must keep working on such an
        /// install rather than failing every neutralise.
        /// </summary>
        [Fact]
        public void a_kernel_without_the_capability_is_a_no_op()
        {
            DerivedCurrencyWithholding.Bind(new Kernel());

            DerivedCurrencyWithholding.ObserveBeforeDerivation(DerivedCurrencyCapability.Science, 100.0);
            DerivedCurrencyWithholding.WithholdDerived(DerivedCurrencyCapability.Science, 25.0, 100.0);
        }

        /// <summary>
        /// An arm is third-party code reflecting into a third-party mod, so it is
        /// the most likely thing on this path to throw, and the science still has to
        /// get neutralised when it does. The other arms still get told, too: one
        /// broken arm must not silence the rest.
        /// </summary>
        [Fact]
        public void a_throwing_arm_does_not_stop_the_neutralise_or_the_other_arms()
        {
            var healthy = new RecordingArm("healthy");
            DerivedCurrencyWithholding.Bind(KernelWith(new ThrowingArm(), healthy));

            DerivedCurrencyWithholding.WithholdDerived(DerivedCurrencyCapability.Science, 25.0, 100.0);

            Assert.Equal(new[] { "withhold science 25 @100" }, healthy.Calls);
        }

        /// <summary>
        /// An arm that throws every time is a leak that is still open, so the throw
        /// is reported and names the arm. A caught exception with nothing said about
        /// it is exactly how it would read as fixed.
        /// </summary>
        [Fact]
        public void a_throwing_arm_is_named_in_a_report()
        {
            var said = new List<string>();
            DerivedCurrencyWithholding.Report = said.Add;
            DerivedCurrencyWithholding.Bind(KernelWith(new ThrowingArm()));

            DerivedCurrencyWithholding.WithholdDerived(DerivedCurrencyCapability.Science, 25.0, 100.0);

            Assert.Single(said);
            Assert.Contains("throwing-arm", said[0], StringComparison.Ordinal);
            Assert.Contains("WithholdDerived", said[0], StringComparison.Ordinal);
        }

        private sealed class RecordingArm : IDerivedCurrencyWithholder
        {
            public RecordingArm(string id)
            {
                ProviderId = id;
            }

            public string ProviderId { get; }

            public List<string> Calls { get; } = new List<string>();

            public void ObserveBeforeDerivation(string primaryCurrency, double ut) =>
                Calls.Add("observe " + primaryCurrency + " @" + ut.ToString("0.###"));

            public void WithholdDerived(string primaryCurrency, double baseAmount, double ut) =>
                Calls.Add("withhold " + primaryCurrency + " " + baseAmount.ToString("0.###") + " @" + ut.ToString("0.###"));
        }

        private sealed class ThrowingArm : IDerivedCurrencyWithholder
        {
            public string ProviderId => "throwing-arm";

            public void ObserveBeforeDerivation(string primaryCurrency, double ut) =>
                throw new InvalidOperationException("no confidence model");

            public void WithholdDerived(string primaryCurrency, double baseAmount, double ut) =>
                throw new InvalidOperationException("no confidence model");
        }
    }
}
