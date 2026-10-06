using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// A propagation provider that can say how far a craft's published conic may be
    /// from the path the craft actually flies, so a client can draw an interval about
    /// what it carries forward.
    ///
    /// <para>Implement it alongside <see cref="IPropagationProvider"/>. A provider
    /// that does not implement it states no error, as stock does.</para>
    /// <internal>
    /// A separate interface rather than a second return value on
    /// IPropagationProvider.CanPropagate: that predicate is on every hot path, and
    /// changing its signature would break every provider.
    /// </internal>
    /// </summary>
    /// <category>Propagation and models</category>
    public interface IPropagationDeparture
    {
        /// <summary>
        /// The departure envelope for <paramref name="target"/> over the window from
        /// <paramref name="fromUt"/> to <paramref name="untilUt"/>, or <c>null</c>
        /// when the provider cannot measure the drift for this craft at this instant.
        ///
        /// <para>Knots ascend in <see cref="PropagationDepartureKnot.UntilUt"/>, the
        /// last equals <paramref name="untilUt"/>, and each carries the largest drift
        /// reached anywhere before it. Null is never replaced by an empty list or by
        /// zeros.</para>
        /// </summary>
        /// <param name="target">The craft, with its osculating elements as the caller has them.</param>
        /// <param name="fromUt">The sample instant.</param>
        /// <param name="untilUt">The end of the reach the provider stated for this craft.</param>
        IReadOnlyList<PropagationDepartureKnot>? DepartureFor(
            PropagationTarget target, double fromUt, double untilUt);
    }
}
