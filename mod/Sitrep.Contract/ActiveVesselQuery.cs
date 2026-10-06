namespace Sitrep.Contract
{
    /// <summary>
    /// Asks which vessel the stream is about, by resolving
    /// <see cref="IActiveVessel"/> through the <see cref="Kernel"/> on each call.
    ///
    /// <para>When the capability cannot be resolved it returns no vessel, never
    /// KSP's active vessel. Report nothing in that case rather than falling back
    /// to <c>FlightGlobals.ActiveVessel</c>, which during an EVA is the kerbal
    /// rather than the craft.</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public static class ActiveVesselQuery
    {
        /// <summary>
        /// The reported vessel as the opaque handle <see cref="IActiveVessel.Reported"/>
        /// carries: a KSP <c>Vessel</c>, which a caller that references KSP casts
        /// with <c>as Vessel</c>.
        ///
        /// <para>Null when there is no flight, when <paramref name="kernel"/> is
        /// null, and when the capability is unknown or unresolved.</para>
        ///
        /// <para>Call it on each read and never hold the result: it changes on a
        /// vessel switch, a dock, an undock, and on both ends of an EVA. Main
        /// thread only, as for <see cref="IActiveVessel"/>.</para>
        /// </summary>
        /// <param name="kernel">The host's Kernel, or null.</param>
        /// <returns>The reported vessel's opaque handle, or null.</returns>
        public static object? ReportedVessel(this Kernel? kernel)
        {
            if (kernel == null)
            {
                return null;
            }

            try
            {
                return kernel.Query<IActiveVessel>(ActiveVesselCapability.Id).Reported;
            }
            catch (System.Exception)
            {
                // Query throws when the capability is unknown or unresolved. Both
                // are "core did not publish it", which is not this Uplink's
                // failure to report and not a reason to take the Uplink down.
                return null;
            }
        }
    }
}
