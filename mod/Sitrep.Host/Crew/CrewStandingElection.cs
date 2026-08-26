using System;
using Sitrep.Contract;

namespace Sitrep.Host.Crew
{
    /// <summary>
    /// The crew-standing election, the same shape as
    /// <see cref="Economy.EconomyElection"/>. ONE EXCLUSIVE capability
    /// <c>"crewStanding"</c> whose active instance is an
    /// <see cref="ICrewStandingBackend"/>.
    ///
    /// <list type="bullet">
    /// <item><b>The stock backend is the capability's Vanilla</b>, and it is a
    /// real reader: KSP's four roster statuses mapped onto the contract's
    /// vocabulary. Every install has it.</item>
    /// <item><b>A career-overhaul mod registers as a provider</b> from its own
    /// uplink's Register, ONLY when its presence probe confirms the mod is
    /// loaded: registering IS the gate.</item>
    /// </list>
    ///
    /// <para><b>Why elect rather than let a client join two channels.</b> A
    /// client could read the roster from one channel and a mod's own retiree
    /// list from another and correct it itself. Every consumer would then have
    /// to learn one vendor's topic names, and a consumer that had not yet
    /// learned them would keep reporting a fatality: the default of a
    /// client-side join is the wrong answer, silently. Electing puts the
    /// correction on the wire once, before any consumer sees it, so a widget
    /// that has never heard of RP-1 is right anyway.</para>
    ///
    /// <para>No provider declares a channel of its own; the standing rides the
    /// <c>spaceCenter.crewRoster</c> entries the space-centre uplink already
    /// publishes, the same shared-namespace-single-declaration rule comms, ISRU
    /// and the economy follow.</para>
    /// </summary>
    public static class CrewStandingElection
    {
        /// <summary>
        /// The exclusive capability id every crew-standing backend competes for,
        /// aliased from the CONTRACT's own declaration rather than spelled again
        /// here: an Uplink cannot reference this assembly, and an id both halves
        /// must spell identically belongs where both halves can reach it. See
        /// <see cref="CrewStandingCapability"/>.
        /// </summary>
        public const string CapabilityId = CrewStandingCapability.Id;

        /// <summary>
        /// Registers the exclusive <c>"crewStanding"</c> capability with
        /// <see cref="StockCrewStandingBackend"/> as its always-present
        /// <see cref="CapabilityDescriptor.Vanilla"/>. Called once at bootstrap,
        /// before <see cref="Kernel.Resolve"/>, from the space-centre uplink's
        /// capability-declaration pass.
        /// </summary>
        /// <remarks>
        /// Takes no vanilla factory, for the same reason the economy election
        /// does not: mapping a roster ordinal onto the contract's vocabulary
        /// needs no KSP, so the stock backend lives here where it is also
        /// headlessly testable.
        ///
        /// <para>Not SpineCritical. A roster whose standings nobody corrects is
        /// still the stock roster, which is what every stock install flies on.</para>
        /// </remarks>
        public static void RegisterCapability(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));

            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = _ => new StockCrewStandingBackend(),
            });
        }

        /// <summary>
        /// Resolve the elected backend after resolution has run. Null when the
        /// capability was never registered or resolved, which a correctly
        /// bootstrapped engine never is: it always has at least the stock backend.
        /// </summary>
        public static ICrewStandingBackend? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<ICrewStandingBackend>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
