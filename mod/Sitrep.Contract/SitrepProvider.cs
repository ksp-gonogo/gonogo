namespace Sitrep.Contract
{
    /// <summary>
    /// What every swappable authority in this contract has in common: it says
    /// what it is.
    ///
    /// <para><b>Why this exists as a base interface rather than a convention.</b>
    /// The seams grew one at a time and each spelled the same member its own way:
    /// <c>BackendId</c> on comms, science, reliability and ISRU, <c>ProviderId</c>
    /// on propagation and maneuver plans, <c>SourceId</c> on command centres. An
    /// author implementing two of them wrote a different name in each for
    /// identical semantics, and nothing said so, because a naming convention that
    /// lives only in the reviewer's head fails silently every time it is broken. A
    /// base interface is the same rule expressed as a mechanism: there is one
    /// declaration, so there is nothing to disagree with.</para>
    ///
    /// <para><b>Provider, not backend.</b> A backend implies serving something
    /// above it. These answer a question: where is this craft, what burns are
    /// planned, is this part broken. <c>ProviderId</c> is the word for that, and
    /// it is also the word the <see cref="Kernel"/> already uses for the thing
    /// registering (<see cref="ProviderRegistration"/>) and the word
    /// <see cref="ProviderExtensionBagAttribute"/> keys a payload namespace
    /// by.</para>
    ///
    /// <para><b>Nothing outside an election may branch on the value.</b> An id is
    /// for diagnostics, for a wire field that states its own provenance, and for
    /// an extension bag's key. A caller that reads it to decide what to do has
    /// re-created the coupling the capability exists to remove: ask the elected
    /// provider, never ask which provider is elected.</para>
    /// </summary>
    public interface ISitrepProvider
    {
        /// <summary>
        /// Stable id of this provider, e.g. <c>"commnet"</c>, <c>"kepler"</c>,
        /// <c>"stock"</c>. Constant for the lifetime of the instance, and the
        /// same string the provider registers with the <see cref="Kernel"/> so a
        /// resolution notice and a wire payload name one identity rather than
        /// two.
        /// </summary>
        string ProviderId { get; }
    }
}
