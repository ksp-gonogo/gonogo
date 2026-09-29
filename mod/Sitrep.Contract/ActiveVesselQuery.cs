namespace Sitrep.Contract
{
    /// <summary>
    /// The one way to ask which vessel the stream is about, written once so the
    /// rule underneath it cannot drift.
    ///
    /// <para>It resolves <see cref="IActiveVessel"/> through the Kernel, per call,
    /// and returns no vessel when it cannot be resolved, so no caller grows a
    /// <c>?? FlightGlobals.ActiveVessel</c> fallback of its own.</para>
    ///
    /// <para><b>Absent means NO VESSEL, never KSP's active vessel.</b> An older core, or
    /// one whose capability declaration failed, leaves the Uplink unable to see
    /// which craft it is reporting on. Reporting nothing says exactly that;
    /// falling back to <c>FlightGlobals.ActiveVessel</c> would say "this is the
    /// craft" about the kerbal standing next to it. A read that could not see the
    /// craft is honest, the wrong craft is not.</para>
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
        /// null, and when the capability is unknown or unresolved: different
        /// causes with one correct consequence, because this read does not know
        /// which craft it is about.</para>
        ///
        /// <para><b>Call it per read and never hold the result.</b> The result
        /// changes on a vessel switch, a dock, an undock, and on both ends of an
        /// EVA. <b>Main thread only</b>, on the same terms as the interface
        /// itself: a capture-on-main or a command handler, never a
        /// channel-source closure.</para>
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
