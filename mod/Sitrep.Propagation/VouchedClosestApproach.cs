using System;
using Sitrep.Contract;

namespace Sitrep.Propagation
{
    /// <summary>
    /// The next closest approach between two targets, kept only when the provider
    /// vouches for both of them from the start of the search to the instant of the
    /// approach.
    ///
    /// <para>The search window is chosen from orbital cycles and can reach far past
    /// what an integrating provider will stand behind. An approach found there is
    /// computed from elements the provider has said it cannot extrapolate that far,
    /// so it is dropped rather than published. The first approach in the window is
    /// still the one asked about: a later, vouched approach is never substituted for
    /// an earlier one that could not be vouched for.</para>
    /// </summary>
    public static class VouchedClosestApproach
    {
        /// <summary>
        /// The provider's answer to <see cref="IPropagationProvider.SolveClosestApproach"/>,
        /// or null when it has none or when <see cref="IPropagationProvider.CanPropagate"/>
        /// refuses either target across <paramref name="fromUt"/> to the approach.
        /// </summary>
        public static ClosestApproach? Solve(
            IPropagationProvider provider,
            PropagationTarget subject,
            PropagationTarget other,
            PropagationFrame frame,
            double fromUt,
            double toUt)
        {
            if (provider == null) throw new ArgumentNullException(nameof(provider));

            var approach = provider.SolveClosestApproach(subject, other, frame, fromUt, toUt);
            if (approach == null)
            {
                return null;
            }

            var until = Math.Max(fromUt, approach.Time);
            if (!provider.CanPropagate(subject, frame, fromUt, until)
                || !provider.CanPropagate(other, frame, fromUt, until))
            {
                return null;
            }

            return approach;
        }
    }
}
