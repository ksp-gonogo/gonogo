using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// <c>Gonogo.KSP.CommsCoreUplink</c>'s <see cref="ISitrepUplink.Health"/>
    /// state machine, as a pure function: mirrors
    /// <c>Gonogo.KerbcastUplink.KerbcastHealth</c> (see that type's doc
    /// comment for the split rationale: a pure function over plain inputs so
    /// it can be exercised headless, while the live uplink only ever touches
    /// KSP).
    ///
    /// <para>Lives in <c>Sitrep.Host.Comms</c>, not <c>Gonogo.KSP</c> (where
    /// <c>CommsCoreUplink</c> itself lives), because <c>Gonogo.KSP.csproj</c>'s
    /// own doc comment is explicit: it is "the ONLY assembly in the mod that
    /// touches KSP/Unity types" and everything else "lives in the KSP-free
    /// Sitrep.* assemblies ... and is headless-tested there".
    /// <see cref="CommsElection.Elected"/> is already a pure <see cref="Kernel"/>
    /// lookup (no live KSP/Unity read), so this state machine sits alongside
    /// it and <c>SignalDelay</c> in this namespace.</para>
    /// </summary>
    public static class CommsHealth
    {
        /// <summary>
        /// Decides the health state from whether the comms election has
        /// resolved to a backend.
        ///
        /// <para>Not <see cref="UplinkHealthState.Unavailable"/>: the core
        /// uplink always registers the vanilla CommNet backend as the
        /// capability's always-present fallback (<see cref="CommsElection.RegisterCapability"/>),
        /// so a null result here means resolution simply has not run yet, not
        /// that comms is broken or absent, the same "registered fine, no
        /// observation yet" shape as kerbcast's pre-first-sample Degraded
        /// case.</para>
        /// </summary>
        /// <param name="backendElected">Whether <see cref="CommsElection.Elected"/> returned a non-null backend.</param>
        /// <param name="modelPresent">
        /// Whether this save models a comms network at all (see
        /// <see cref="CommsModelPolicy"/>). A definite <c>false</c> is not a
        /// fault: nothing is broken, there is simply nothing to report a link
        /// over, and every channel flows live. It is still worth SAYING,
        /// because a bare "Healthy" beside a board that shows no path, no
        /// relay graph and no light-time reads as an uplink that has quietly
        /// stopped observing. <c>null</c> (no save loaded yet, or the read
        /// threw) adds nothing.
        /// </param>
        public static UplinkHealth Evaluate(bool backendElected, bool? modelPresent = null)
        {
            if (!backendElected)
            {
                return new UplinkHealth(UplinkHealthState.Degraded, "no comms backend elected");
            }
            if (modelPresent == false)
            {
                return new UplinkHealth(
                    UplinkHealthState.Healthy,
                    "CommNet off in this save's difficulty settings: no network is modelled, so there is no path, no relay graph and no delay");
            }
            return new UplinkHealth(UplinkHealthState.Healthy);
        }
    }
}
