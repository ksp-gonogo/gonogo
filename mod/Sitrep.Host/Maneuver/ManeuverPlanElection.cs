using System;
using Sitrep.Contract;

namespace Sitrep.Host.Maneuver
{
    /// <summary>
    /// The maneuver-plan election. ONE EXCLUSIVE capability
    /// <c>"maneuverPlan"</c> whose active instance is an
    /// <see cref="IManeuverPlanSource"/>, expressed entirely in terms of the
    /// existing <see cref="Kernel"/> with no new mechanism.
    ///
    /// <list type="bullet">
    /// <item><b>The stock patched-conic solver is the capability's Vanilla
    /// factory</b>: the structural "a maneuver plan is never unsatisfiable"
    /// guarantee. Stock KSP genuinely plans with impulsive nodes on a
    /// patched-conic chain, so the vanilla is the correct answer for an
    /// unmodified game and not a null object.</item>
    /// <item><b>A provider registers itself</b> from its own uplink's Register,
    /// through the kernel's generic <c>RegisterProvider</c>, and only when its
    /// own probe confirms the planner it models is actually loaded.
    /// Registering IS the gate.</item>
    /// </list>
    ///
    /// <para><b>This file names no mod, and that is a rule rather than an
    /// accident</b>, the same rule <c>PropagationElection</c> states: a
    /// provider announces what it is through
    /// <see cref="IManeuverPlanSource.ProviderId"/>, and callers ask the
    /// elected provider rather than asking which provider is elected.
    /// <c>packages/core/src/uplink-boundary.test.ts</c> is what keeps it true,
    /// and this file must pass it with no allowlist entry at all.</para>
    ///
    /// <para><b>The read shape generalises; the WRITE does not.</b>
    /// <c>vessel.maneuver.add</c>/<c>.update</c>/<c>.remove</c> are not part of
    /// this capability, because a planner can perfectly well publish a plan it
    /// will not let anything outside itself author. A provider that accepts
    /// authored burns is a later, separate seam, and until it exists a
    /// non-stock provider must be assumed read-only.</para>
    /// </summary>
    public static class ManeuverPlanElection
    {
        /// <summary>The exclusive capability id every maneuver-plan provider competes for.</summary>
        public const string CapabilityId = ManeuverPlanCapability.Id;

        /// <summary>
        /// Registers the exclusive <c>"maneuverPlan"</c> capability with the
        /// stock solver as its always-present
        /// <see cref="CapabilityDescriptor.Vanilla"/> factory. Called from the
        /// vessel uplink's <c>DeclareCapabilities</c> (the pre-Register
        /// discovery pass) so the capability exists before any uplink's
        /// <c>Register</c> runs and a provider registration can never race
        /// ahead of this declaration.
        ///
        /// <para>Not <see cref="CapabilityDescriptor.SpineCritical"/>: losing
        /// the plan costs one topic, and the rest of the vessel stream is still
        /// good telemetry without it.</para>
        /// </summary>
        public static void RegisterCapability(
            Kernel kernel,
            Func<ProviderContext, IManeuverPlanSource> stockVanillaFactory)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            if (stockVanillaFactory == null) throw new ArgumentNullException(nameof(stockVanillaFactory));

            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = CapabilityId,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = ctx => stockVanillaFactory(ctx),
            });
        }

        /// <summary>
        /// Resolve the elected provider after resolution has run. Returns null
        /// if the capability was never registered or resolved (defensive: a
        /// correctly bootstrapped engine always has at least the stock
        /// vanilla).
        /// </summary>
        public static IManeuverPlanSource? Elected(Kernel kernel)
        {
            if (kernel == null) throw new ArgumentNullException(nameof(kernel));
            try
            {
                return kernel.Query<IManeuverPlanSource>(CapabilityId);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Hands a command-centre-composed plan to whoever owns the craft's plan.
        ///
        /// <para>Through the election rather than at a named planner, which is
        /// what makes a plan sendable without the sender knowing what is flying
        /// it. The same source that REPORTS the plan receives it, so an operator
        /// cannot read one plan and replace another.</para>
        ///
        /// <para>A null plan is refused rather than treated as an empty one. An
        /// empty burn list is a real instruction, it clears the plan, and a
        /// malformed command that arrived without its burns would otherwise wipe a
        /// craft's plan while reporting success.</para>
        /// </summary>
        public static CommandResult Send(Kernel? kernel, SendManeuverPlanArgs? plan)
        {
            if (plan == null || plan.Burns == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Unknown,
                    "The command carried no burns. An empty plan clears the craft's plan "
                        + "and is sent as an empty list; a missing list is a malformed "
                        + "command and is not acted on.");
            }

            var source = kernel == null ? null : Elected(kernel);
            if (source == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "Nothing here owns this craft's flight plan, so there is nothing to "
                        + "install it into.");
            }

            return source.SendPlan(plan);
        }
    }
}
