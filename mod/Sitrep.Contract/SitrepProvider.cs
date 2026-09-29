namespace Sitrep.Contract
{
    /// <summary>
    /// The member every swappable provider in this contract shares: its own id.
    /// A comms, science, reliability, ISRU, propagation, maneuver-plan or
    /// command-centre provider implements this, so each one names itself the
    /// same way.
    ///
    /// <para>The id is for diagnostics, for a wire field that states where a
    /// value came from, and for the key of an extension bag
    /// (<see cref="ProviderExtensionBagAttribute"/>). Do not branch on it: ask the
    /// elected provider what you need, never ask which provider is elected.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public interface ISitrepProvider
    {
        /// <summary>
        /// Stable id of this provider, e.g. <c>"commnet"</c>, <c>"kepler"</c>,
        /// <c>"stock"</c>. Constant for the lifetime of the instance, and the
        /// same string the provider registers with the <see cref="Kernel"/>
        /// (<see cref="ProviderRegistration"/>), so a resolution notice and a
        /// wire payload name the same identity.
        /// </summary>
        string ProviderId { get; }
    }
}
