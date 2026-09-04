namespace Sitrep.Contract
{
    /// <summary>
    /// The one way to ask which vessel the stream is about, written once so the
    /// rule underneath it cannot drift.
    ///
    /// <para>Every Uplink that reports on "the vessel" needs the same six lines:
    /// resolve <see cref="IActiveVessel"/> through the Kernel, per call, and
    /// answer with no vessel when it cannot be resolved. Nine copies of that is
    /// nine chances for one of them to grow a <c>?? FlightGlobals.ActiveVessel</c>
    /// fallback, which is the exact mistake the capability exists to prevent, so
    /// the fallback lives here instead of in each caller.</para>
    ///
    /// <para><b>Absent means NO VESSEL, never KSP's answer.</b> An older core, or
    /// one whose capability declaration failed, leaves the Uplink unable to see
    /// which craft it is reporting on. Reporting nothing says exactly that;
    /// falling back to <c>FlightGlobals.ActiveVessel</c> would say "this is the
    /// craft" about the kerbal standing next to it. A read that could not see the
    /// craft is honest, the wrong craft is not.</para>
    /// </summary>
    public static class ActiveVesselQuery
    {
        /// <summary>
        /// The reported vessel as the opaque handle <see cref="IActiveVessel.Reported"/>
        /// carries: a KSP <c>Vessel</c>, which a caller that references KSP casts
        /// with <c>as Vessel</c>.
        ///
        /// <para>Null when there is no flight, when <paramref name="kernel"/> is
        /// null, and when the capability is not resolvable, which are four
        /// different causes with one correct consequence: this read does not know
        /// which craft it is about, so it answers about none.</para>
        ///
        /// <para><b>Call it per read and never hold the result.</b> The answer
        /// changes on a vessel switch, a dock, an undock, and on both ends of an
        /// EVA. <b>Main thread only</b>, on the same terms as the interface
        /// itself: a capture-on-main or a command handler, never a
        /// channel-source closure.</para>
        /// </summary>
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
