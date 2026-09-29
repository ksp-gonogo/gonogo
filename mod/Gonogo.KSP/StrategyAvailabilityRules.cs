using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The core's side of the <c>"strategyAvailability"</c> capability: asks every
    /// installed career mod whether it holds a rule against a strategy that KSP's
    /// own activation gate does not.
    ///
    /// <para>A static pointer to the live <see cref="Kernel"/>, because both of
    /// its callers are static (the roster capture in <c>KspHost</c> and the
    /// activate command in <see cref="KspCareerActuator"/>) and neither has an
    /// <c>IUplinkHost</c>. Providers are resolved on every call, never cached:
    /// capability resolution runs after the last Uplink's <c>Register</c>, so a
    /// list captured at bind time would be empty for the whole session.</para>
    ///
    /// <para>No KSP or Unity type appears here, so it is exercised
    /// headlessly.</para>
    /// </summary>
    public static class StrategyAvailabilityRules
    {
        private static Kernel? _kernel;

        /// <summary>Points the rules at the kernel the career Uplink registered with.</summary>
        public static void Bind(Kernel? kernel) => _kernel = kernel;

        /// <summary>
        /// The first refusal any installed mod holds against
        /// <paramref name="strategyId"/>, or <c>null</c> when none does, when no
        /// kernel is bound, or when the capability was never declared.
        ///
        /// <para>A provider that throws is reported and skipped. Its question went
        /// unanswered, and an unanswered question is not a refusal.</para>
        /// </summary>
        public static StrategyUnavailability? Refusal(string? strategyId)
        {
            if (string.IsNullOrEmpty(strategyId)) return null;

            foreach (var provider in Providers())
            {
                StrategyUnavailability? refusal;
                try
                {
                    refusal = provider.Unavailable(strategyId!);
                }
                catch (Exception ex)
                {
                    Report("[Gonogo] strategy-availability provider \"" + SafeId(provider)
                        + "\" threw for " + strategyId + ", so its rule was not applied: " + ex.Message);
                    continue;
                }

                if (refusal != null) return refusal;
            }

            return null;
        }

        private static IEnumerable<IStrategyAvailability> Providers()
        {
            var kernel = _kernel;
            if (kernel == null) yield break;

            IReadOnlyList<object?> instances;
            try
            {
                instances = kernel.Active(StrategyAvailabilityCapability.CapabilityId);
            }
            catch (Exception)
            {
                yield break;
            }

            foreach (var instance in instances)
            {
                if (instance is IStrategyAvailability provider) yield return provider;
            }
        }

        private static string SafeId(IStrategyAvailability provider)
        {
            try
            {
                return provider.ProviderId ?? "";
            }
            catch (Exception)
            {
                return provider.GetType().Name;
            }
        }

        /// <summary>
        /// Where a provider's fault is reported. Assignable so the headless suite
        /// can read it; the career Uplink points it at the game log.
        /// </summary>
        public static Action<string> Report { get; set; } = _ => { };
    }
}
