using System;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The simulation-backend election: ONE EXCLUSIVE capability
    /// <c>"simulation"</c> whose active instance is an
    /// <see cref="ISimulationBackend"/>, the same shape as the economy and
    /// comms elections beside it.
    ///
    /// <para><b>The vanilla answers "no such concept", not "no".</b> Stock KSP
    /// has no rehearsal mode, so the truthful stock answer to "is this a
    /// simulation" is that the question does not apply. A vanilla returning
    /// <c>false</c> would let a client label every stock flight a confirmed
    /// mission, which it has no basis to do.</para>
    ///
    /// <para><b>Why elect rather than let each mod publish its own topic.</b>
    /// The consumer is core: every <c>flight.*</c> and <c>vessel.*</c> channel
    /// is misreported by a rehearsal, and the reveal gate cuts light-time for
    /// one. Neither can learn a vendor's topic name. RP-1 has the concept
    /// today and will not be the last mod to; electing means the next one
    /// registers a provider instead of adding a parallel channel nothing
    /// core reads.</para>
    /// </summary>
    public static class SimulationElection
    {
        /// <summary>The exclusive capability id every simulation backend competes for.</summary>
        public const string CapabilityId = "simulation";

        /// <summary>
        /// Registers the exclusive <c>"simulation"</c> capability with
        /// <see cref="NoSimulationBackend"/> as its always-present vanilla.
        /// Called once at bootstrap, before <see cref="Kernel.Resolve"/>, from
        /// the flight uplink's capability-declaration pass. Not SpineCritical:
        /// a game with no rehearsal mode is the overwhelming majority of them.
        /// </summary>
        public static void RegisterCapability(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));

            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = _ => new NoSimulationBackend(),
            });
        }

        /// <summary>
        /// The elected backend, or null before the kernel has resolved. Null is
        /// read the same way <see cref="NoSimulationBackend"/> answers: nothing
        /// has an opinion yet.
        /// </summary>
        public static ISimulationBackend? Elected(Kernel? kernel)
        {
            if (kernel == null)
            {
                return null;
            }

            try
            {
                return kernel.Query<ISimulationBackend>(CapabilityId);
            }
            catch (Exception)
            {
                // An unresolved or unregistered capability is "nobody has said",
                // which is the same answer the vanilla gives. Never a reason to
                // take down a capture.
                return null;
            }
        }
    }

    /// <summary>
    /// The vanilla <c>"simulation"</c> backend: this game has no concept of a
    /// rehearsal, so it declines to answer rather than answering no.
    /// </summary>
    public sealed class NoSimulationBackend : ISimulationBackend
    {
        public string ProviderId => "stock";

        public bool? IsSimulatedFlight() => null;
    }
}
