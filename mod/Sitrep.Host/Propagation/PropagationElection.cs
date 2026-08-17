using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation;

namespace Sitrep.Host.Propagation
{
    /// <summary>
    /// The propagation election, expressed entirely in terms of the existing
    /// <see cref="Kernel"/>. ONE EXCLUSIVE capability <c>"propagation"</c> whose
    /// active instance is an <see cref="IPropagationProvider"/>:
    ///
    /// <list type="bullet">
    /// <item><b><see cref="KeplerProvider"/> is the capability's Vanilla
    /// factory</b>: the structural "propagation is never unsatisfiable" guarantee.
    /// Stock KSP physics IS two-body, so the vanilla is not a null object here, it
    /// is the correct answer for an unmodified game.</item>
    /// <item><b>A provider registers itself</b> from its own uplink's Register,
    /// through the kernel's generic <c>RegisterProvider</c>, and only when its own
    /// probe confirms the physics it models is actually loaded. Registering IS the
    /// gate.</item>
    /// </list>
    ///
    /// <para><b>This file names no mod, and that is a rule rather than an
    /// accident.</b> The comms, action-groups and target-approach elections each
    /// grew a mod-named public triple (<c>XProviderId</c>, <c>XPriority</c>,
    /// <c>RegisterXProvider</c>), which puts a specific third-party mod's name in
    /// core's API surface. Two of those three were never called by anything but
    /// tests. A provider announces what it is through
    /// <see cref="IPropagationProvider.ProviderId"/>, and callers ask the elected
    /// provider rather than asking which provider is elected, so nothing outside
    /// the election ever branches on identity. The check that keeps this true is
    /// <c>packages/core/src/uplink-boundary.test.ts</c>, which this file must pass
    /// with no allowlist entry at all.</para>
    ///
    /// <para>Lives in <c>Sitrep.Host</c> rather than beside
    /// <see cref="IPropagationProvider"/> because <c>Sitrep.Propagation</c> is
    /// deliberately BCL-only and does not reference <c>Sitrep.Contract</c>, where
    /// <see cref="Kernel"/> lives. Same reason <c>TargetApproachElection</c> sits
    /// here rather than next to its own interface.</para>
    /// </summary>
    public static class PropagationElection
    {
        /// <summary>The exclusive capability id every propagation provider competes for.</summary>
        public const string CapabilityId = "propagation";

        /// <summary>
        /// Registers the exclusive <c>"propagation"</c> capability with
        /// <see cref="KeplerProvider"/> as its always-present Vanilla factory.
        /// Called once at bootstrap, before <see cref="Kernel.Resolve"/>, from a
        /// core uplink's <c>DeclareCapabilities</c> pass so the capability exists
        /// before any uplink's <c>Register</c> runs and a provider registration can
        /// never race ahead of this declaration.
        ///
        /// <para>Not <see cref="CapabilityDescriptor.SpineCritical"/>: losing
        /// propagation degrades the silence predictor and the visibility sweep, and
        /// the rest of the telemetry stream is still good without them.</para>
        /// </summary>
        /// <param name="systemTable">
        /// Where the vanilla reads the body hierarchy from, so it can answer in a
        /// frame centred on something other than the body a target orbits. Read on
        /// demand because the capability is declared at bootstrap, before the game
        /// has a body list. Omitted, the vanilla still serves every parent-frame
        /// question and declines the rest, which is what the headless tests want.
        /// </param>
        public static void RegisterCapability(
            Kernel kernel, Func<IReadOnlyList<SystemBody>>? systemTable = null)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = _ => new KeplerProvider(systemTable),
            });
        }

        /// <summary>
        /// Resolve the elected provider after resolution has run. Returns null if
        /// the capability was never registered or resolved (defensive, a correctly
        /// bootstrapped engine always has at least the stock vanilla).
        /// </summary>
        public static IPropagationProvider? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<IPropagationProvider>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The elected provider, or the stock two-body solver when nothing is
        /// resolved. For call sites that want a provider unconditionally and have
        /// no sensible behaviour without one.
        /// </summary>
        public static IPropagationProvider ElectedOrStock(Kernel kernel) =>
            Elected(kernel) ?? new KeplerProvider();
    }
}
