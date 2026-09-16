using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// Conformance assertions an implementer runs against their OWN implementation
    /// of a seam.
    ///
    /// <para><b>Why a shipped assertion rather than a test in this repo.</b> A seam
    /// is a gate: something in core asks <c>x is ISomething</c> and behaves
    /// differently when it is. The behaviour behind that gate is normally proved by
    /// a test that hands the gate an implementation it wrote itself, which
    /// establishes what happens AFTER the gate and nothing about whether anyone
    /// else's implementation would get through it. Every such test passes over a
    /// seam nobody could correctly fill, and one did: <c>IIntegratedTrajectorySource</c>
    /// shipped with a declaration, one <c>is</c> check and no implementer, and the
    /// whole n-body horizon reported closed-form on every live frame while the
    /// suite stayed green.</para>
    ///
    /// <para>So the assertion has to be the same one on both sides. An outside
    /// author calls it on their implementation and learns whether they got it
    /// right; this repo calls it on its own and learns the same thing. It lives
    /// here because <see cref="Sitrep.Contract.TestSupport"/> is SHIPPED, vendored
    /// to an Uplink's <c>vendor/devkit</c> and packed into the net10.0 group of
    /// the <c>KspGonogo.Sitrep.Contract</c> NuGet package, so "an implementer can
    /// run it" is a fact about the package rather than a hope.</para>
    ///
    /// <para><b>It asserts the contract, never an implementation's choices.</b>
    /// What a provider IS remains entirely the provider's business. What it owes
    /// is what the interface's own doc comment promises, and nothing beyond.</para>
    /// </summary>
    public static class SeamConformance
    {
        /// <summary>
        /// Everything <see cref="ISitrepProvider"/> promises, which every capability
        /// seam in the contract inherits: an id that is present, that does not
        /// change under the caller's feet, and that is a token rather than a label.
        ///
        /// <para>Call the <see cref="AssertProviderContract(ISitrepProvider, ProviderRegistration)"/>
        /// overload wherever the registration is in hand. The promise that the two
        /// strings are the SAME string is the half of this contract that actually
        /// breaks, and it cannot be checked from the instance alone.</para>
        /// </summary>
        /// <param name="provider">The implementation under test.</param>
        public static void AssertProviderContract(ISitrepProvider provider)
        {
            Assert.NotNull(provider);

            var id = provider.ProviderId;

            Assert.False(
                string.IsNullOrWhiteSpace(id),
                provider.GetType().Name + ".ProviderId is empty. It names this provider in a "
                + "resolution notice, in a wire payload's own statement of provenance, and as an "
                + "extension bag's key; there is no default that could stand in for it.");

            // Read it again rather than trusting the first read: an id computed per
            // call (a guid, a timestamp, a state-dependent name) satisfies every
            // single-read assertion and then names a different provider each time
            // it is asked, which no caller can hold onto.
            Assert.True(
                string.Equals(id, provider.ProviderId, StringComparison.Ordinal),
                provider.GetType().Name + ".ProviderId changed between reads. It is constant for "
                + "the lifetime of the instance: a caller stores it, puts it on the wire, and "
                + "compares it later.");

            Assert.False(
                id.IndexOf(' ') >= 0 || id != id.Trim(),
                provider.GetType().Name + ".ProviderId is \"" + id + "\", which reads as a display "
                + "name rather than an id. It keys an extension bag's payload namespace and is "
                + "compared verbatim, so it is a token: \"commnet\", \"kepler\", \"stock\".");
        }

        /// <summary>
        /// As above, plus the promise that cannot be checked from the instance
        /// alone: the id a provider REPORTS is the id it REGISTERS with the
        /// <see cref="Kernel"/>.
        ///
        /// <para>Two strings mean one identity only if they are equal, and nothing
        /// makes them equal: a provider hands one to
        /// <see cref="ProviderRegistration.Id"/> and returns the other from
        /// <see cref="ISitrepProvider.ProviderId"/>. When they differ, a resolution
        /// notice names one provider and the payload that provider wrote names
        /// another, and there is no symptom beyond two names for one thing.</para>
        /// </summary>
        /// <param name="provider">The implementation under test.</param>
        /// <param name="registration">The registration this provider is offered to the Kernel under.</param>
        public static void AssertProviderContract(
            ISitrepProvider provider, ProviderRegistration registration)
        {
            AssertProviderContract(provider);
            Assert.NotNull(registration);

            Assert.True(
                string.Equals(provider.ProviderId, registration.Id, StringComparison.Ordinal),
                provider.GetType().Name + " reports ProviderId \"" + provider.ProviderId
                + "\" and registers as \"" + registration.Id + "\". These are one identity, and "
                + "when they differ a resolution notice names one provider while the payload that "
                + "provider wrote names another.");
        }

    }
}
