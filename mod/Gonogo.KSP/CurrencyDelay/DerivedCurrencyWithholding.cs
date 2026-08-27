using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// The core's side of the <c>"derivedCurrency"</c> capability: tells every
    /// registered arm when a primary currency change was asked for and when the
    /// interceptor neutralised one, so a quantity some other mod derives from
    /// that change stays withheld for as long as the change is.
    ///
    /// <para>A static pointer to the live <see cref="Kernel"/>, the same shape
    /// <c>CommsCoreUplink.ConfigureSimulationKernel</c> uses and for the same
    /// reason: the interceptor is owned by a <c>ScenarioModule</c>, which has no
    /// <c>IUplinkHost</c> and therefore no kernel of its own. It holds no derived
    /// state, only the reference, so the "all pending state lives in the
    /// persisted scenario module" invariant is untouched.</para>
    ///
    /// <para><b>Resolved on every call, never cached.</b>
    /// <c>ChannelEngine.ResolveCapabilities</c> runs after the last uplink's
    /// <c>Register</c>, so an arm list captured at bind time would be empty for
    /// the whole session. Asking the kernel each time is two dictionary lookups
    /// and cannot be stale.</para>
    ///
    /// <para>No KSP or Unity type appears here, so unlike its caller this file
    /// compiles and is exercised headlessly.</para>
    /// </summary>
    public static class DerivedCurrencyWithholding
    {
        private static Kernel? _kernel;

        /// <summary>Whether the capability was reachable the last time an arm was asked for, so a caller can tell "no mod derives anything" from "nobody bound a kernel".</summary>
        public static bool Bound => _kernel != null;

        public static void Bind(Kernel? kernel) => _kernel = kernel;

        public static void Unbind() => _kernel = null;

        /// <summary>
        /// A change to <paramref name="primaryCurrency"/> has been asked for.
        /// Fans out to every arm so each can record its pre-derivation reading.
        /// </summary>
        public static void ObserveBeforeDerivation(string primaryCurrency, double ut)
        {
            foreach (var arm in Arms())
            {
                Safely(arm, "ObserveBeforeDerivation", () => arm.ObserveBeforeDerivation(primaryCurrency, ut));
            }
        }

        /// <summary>
        /// The interceptor has just neutralised a <paramref name="primaryCurrency"/>
        /// change of <paramref name="baseAmount"/>. Fans out to every arm so each
        /// can put back what its mod derived from it.
        /// </summary>
        public static void WithholdDerived(string primaryCurrency, double baseAmount, double ut)
        {
            foreach (var arm in Arms())
            {
                Safely(arm, "WithholdDerived", () => arm.WithholdDerived(primaryCurrency, baseAmount, ut));
            }
        }

        /// <summary>
        /// The active arms, or none at all when no kernel is bound or the
        /// capability was never declared. A capability the kernel does not know
        /// throws out of <c>Active</c>, which is the one case worth swallowing
        /// here: an install where this capability is absent is not an install
        /// where currency delay should stop working.
        /// </summary>
        private static IEnumerable<IDerivedCurrencyWithholder> Arms()
        {
            var kernel = _kernel;
            if (kernel == null)
            {
                yield break;
            }

            IReadOnlyList<object?> instances;
            try
            {
                instances = kernel.Active(DerivedCurrencyCapability.CapabilityId);
            }
            catch (Exception)
            {
                yield break;
            }

            foreach (var instance in instances)
            {
                if (instance is IDerivedCurrencyWithholder arm)
                {
                    yield return arm;
                }
            }
        }

        /// <summary>
        /// Runs one arm's call, reporting a throw rather than letting it reach the
        /// interceptor. An arm is third-party code reflecting into a third-party
        /// mod: it is the most likely thing here to throw, and a currency change
        /// must still be neutralised when it does.
        ///
        /// <para>Reported, never swallowed silently: an arm that throws every time
        /// is a leak that is still open, and a caught exception with nothing said
        /// about it is exactly how it would read as fixed.</para>
        /// </summary>
        private static void Safely(IDerivedCurrencyWithholder arm, string call, Action action)
        {
            try
            {
                action();
            }
            catch (Exception ex)
            {
                Report("[Gonogo] derived-currency arm \"" + SafeId(arm) + "\" threw out of " + call
                    + ", so whatever it derives is NOT withheld: " + ex.Message);
            }
        }

        private static string SafeId(IDerivedCurrencyWithholder arm)
        {
            try
            {
                return arm.ProviderId ?? "";
            }
            catch (Exception)
            {
                return arm.GetType().Name;
            }
        }

        /// <summary>
        /// Where a report goes. Assignable so the headless suite can read what was
        /// said: <c>UnityEngine.Debug</c> is the shipped destination and is not
        /// loadable here, and a warning nothing can observe is a warning that gets
        /// deleted by the next person who cannot see it firing.
        /// </summary>
        public static Action<string> Report { get; set; } = _ => { };
    }
}
