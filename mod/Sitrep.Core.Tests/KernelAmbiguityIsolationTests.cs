using System;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// An unbreakable tie on ONE exclusive capability leaves that capability
    /// unresolved and every other capability resolved.
    ///
    /// <para>The tie-break rules are unchanged: a preference, then a sole
    /// default, then a unique highest priority, and anything else is ambiguous.
    /// What changed is the blast radius. The ambiguity used to throw out of
    /// <see cref="Kernel.Resolve"/>, which aborted the election for every
    /// capability together, so one mis-prioritised pair of claimants silently
    /// switched off comms, science, reliability and the home command at once.
    /// It is now an "ambiguous" notice per tied provider, and nothing else is
    /// touched.</para>
    /// </summary>
    public class KernelAmbiguityIsolationTests
    {
        private static ResolveOptions Opts() => new ResolveOptions { KernelVersion = "1.0.0" };

        private static Kernel TwoCapabilities()
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = "contested",
                Exclusive = true,
                Vanilla = _ => "vanilla",
            });
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = "comms",
                Exclusive = true,
                Vanilla = _ => "vanilla",
            });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "comms",
                Id = "comms-high",
                Priority = 20.0,
                Factory = _ => "comms-high",
            });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "comms",
                Id = "comms-low",
                Priority = 10.0,
                Factory = _ => "comms-low",
            });
            return kernel;
        }

        private static void Contest(Kernel kernel, string id, double priority = 0, bool isDefault = false)
        {
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "contested",
                Id = id,
                Priority = priority,
                IsDefault = isDefault,
                Factory = _ => id,
            });
        }

        private static string[] AmbiguousIds(ResolveResult result, string capability) =>
            result.Notices
                .Where(n => n.Capability == capability && n.Kind == "ambiguous")
                .Select(n => n.ProviderId!)
                .OrderBy(id => id, StringComparer.Ordinal)
                .ToArray();

        [Fact]
        public void ATopPriorityTie_LeavesOnlyThatCapabilityUnresolved()
        {
            var kernel = TwoCapabilities();
            Contest(kernel, "comms-claimant", priority: 10.0);
            Contest(kernel, "overhaul-claimant", priority: 10.0);

            var result = kernel.Resolve(Opts());

            Assert.Equal(new object?[] { "comms-high" }, kernel.Active("comms"));
            Assert.Equal(new[] { "comms-claimant", "overhaul-claimant" }, AmbiguousIds(result, "contested"));
            Assert.Same(result.Notices, kernel.LastNotices);
        }

        /// <summary>
        /// Unresolved means no instance at all, and in particular NOT the vanilla.
        /// Falling back would be the kernel quietly picking a winner, which is the
        /// thing the ambiguity rule exists to refuse.
        /// </summary>
        [Fact]
        public void AnAmbiguousCapability_DoesNotFallBackToItsVanilla()
        {
            var kernel = TwoCapabilities();
            Contest(kernel, "a", priority: 3.0);
            Contest(kernel, "b", priority: 3.0);

            var result = kernel.Resolve(Opts());

            Assert.Empty(kernel.Active("contested"));
            Assert.DoesNotContain(result.Notices, n => n.Capability == "contested" && n.Kind == "vanilla-fallback");
            Assert.All(
                result.Notices.Where(n => n.Kind == "ambiguous"),
                n => Assert.Contains("\"contested\"", n.Detail));
        }

        [Fact]
        public void TwoDefaults_LeaveOnlyThatCapabilityUnresolved()
        {
            var kernel = TwoCapabilities();
            Contest(kernel, "a", priority: 10.0, isDefault: true);
            Contest(kernel, "b", priority: 1.0, isDefault: true);
            Contest(kernel, "c", priority: 99.0);

            var result = kernel.Resolve(Opts());

            Assert.Equal(new object?[] { "comms-high" }, kernel.Active("comms"));
            Assert.Empty(kernel.Active("contested"));
            Assert.Equal(new[] { "a", "b" }, AmbiguousIds(result, "contested"));
        }

        [Fact]
        public void WithNoTie_ResolutionIsUnchanged()
        {
            var kernel = TwoCapabilities();
            Contest(kernel, "a", priority: 10.0);
            Contest(kernel, "b", priority: 20.0);

            var result = kernel.Resolve(Opts());

            Assert.Equal(new object?[] { "b" }, kernel.Active("contested"));
            Assert.Equal(new object?[] { "comms-high" }, kernel.Active("comms"));
            Assert.DoesNotContain(result.Notices, n => n.Kind == "ambiguous" || n.Kind == "selection-failed");
            Assert.Equal(
                new[] { "contested|superseded|a", "comms|superseded|comms-low" },
                result.Notices.Select(n => $"{n.Capability}|{n.Kind}|{n.ProviderId}").ToArray());
        }

        /// <summary>
        /// A capability that depends on an ambiguous one is not dragged down with
        /// it: its factory's query fails like any other unsatisfied dependency, and
        /// it recovers through its own vanilla.
        /// </summary>
        [Fact]
        public void ADependentOfAnAmbiguousCapability_RecoversThroughItsOwnVanilla()
        {
            var kernel = TwoCapabilities();
            Contest(kernel, "a");
            Contest(kernel, "b");
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = "dependent",
                Exclusive = true,
                Vanilla = _ => "vanilla",
            });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "dependent",
                Id = "needs-contested",
                Deps = new[] { "contested" },
                Factory = ctx => ctx.Query<string>("contested"),
            });

            var result = kernel.Resolve(Opts());

            Assert.Equal(new object?[] { "vanilla" }, kernel.Active("dependent"));
            Assert.Equal(new object?[] { "comms-high" }, kernel.Active("comms"));
            Assert.Contains(result.Notices, n => n.Capability == "dependent" && n.Kind == "factory-failed");
        }

        /// <summary>
        /// A provider's own <see cref="ProviderRegistration.CanServe"/> is provider
        /// code running inside selection, so it can throw. That leaves its
        /// capability unresolved and says so, the same isolation an ambiguity gets.
        /// </summary>
        [Fact]
        public void AThrowingCanServe_LeavesOnlyThatCapabilityUnresolved()
        {
            var kernel = TwoCapabilities();
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "contested",
                Id = "broken",
                CanServe = () => throw new InvalidOperationException("settings not parsed"),
                Factory = _ => "broken",
            });

            var result = kernel.Resolve(Opts());

            Assert.Empty(kernel.Active("contested"));
            Assert.Equal(new object?[] { "comms-high" }, kernel.Active("comms"));
            var failed = Assert.Single(result.Notices, n => n.Kind == "selection-failed");
            Assert.Equal("contested", failed.Capability);
            Assert.Contains("settings not parsed", failed.Detail);
        }

        /// <summary>
        /// A re-resolve that turns a capability ambiguous clears the instance the
        /// previous resolution left behind, rather than leaving a stale winner
        /// active under a notice that says there is none.
        /// </summary>
        [Fact]
        public void AReResolveThatBecomesAmbiguous_ClearsThePreviousWinner()
        {
            var kernel = TwoCapabilities();
            Contest(kernel, "a", priority: 5.0);
            kernel.Resolve(Opts());
            Assert.Equal(new object?[] { "a" }, kernel.Active("contested"));

            Contest(kernel, "b", priority: 5.0);
            kernel.Resolve(Opts());

            Assert.Empty(kernel.Active("contested"));
            Assert.Equal(new object?[] { "comms-high" }, kernel.Active("comms"));
        }

        /// <summary>
        /// The spine-critical halt is NOT isolated. A spine-critical capability with
        /// nothing to serve it means the kernel cannot start, so it still throws out
        /// of the whole resolution and activates nothing.
        /// </summary>
        [Fact]
        public void ASpineCriticalHalt_StillAbortsTheWholeResolution()
        {
            var kernel = TwoCapabilities();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = "life-support",
                Exclusive = true,
                SpineCritical = true,
            });

            Assert.Throws<SpineCapabilityUnsatisfiedError>(() => kernel.Resolve(Opts()));
            Assert.Empty(kernel.Active("comms"));
        }
    }
}
