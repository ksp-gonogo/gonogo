namespace Sitrep.Contract
{
    /// <summary>
    /// A propagation provider that says how long a body's published elements
    /// stay accurate.
    ///
    /// <para>Under stock physics a body rides a fixed conic about a fixed parent,
    /// so its elements hold forever and no provider needs this. Under n-body
    /// physics a body's elements are the conic touching its integrated path at
    /// the sample instant, for a moon exactly as for a craft, and carried forward
    /// too far they place the body where it is not. Implement this on a provider
    /// whose force model can say how far. A provider that does not implement it
    /// says nothing about bodies.</para>
    /// <internal>
    /// Separate from IPropagationProvider.CanPropagate, which already takes a
    /// window, because that member is asked by the machinery that computes a
    /// bound: the acceleration walk behind a craft's horizon places each
    /// perturbing body through it, so a provider that bounded a body there would
    /// refuse the walk its own result is made of. A marker rather than a property
    /// so a provider cannot claim an unbounded ephemeris by omission.
    /// </internal>
    /// </summary>
    /// <category>Propagation and models</category>
    public interface IBodyEphemerisHorizon
    {
        /// <summary>
        /// How many seconds past <paramref name="fromUt"/> this body's published
        /// elements stay accurate, or <c>null</c> when nothing can be said.
        ///
        /// <para>Return null, never a long span, when the install has no readable
        /// force model or the provider cannot place the body. Gonogo publishes null
        /// as <see cref="PropagationHorizonKind.Unspecified"/>, not as a
        /// number.</para>
        /// </summary>
        /// <param name="bodyIndex">The body's index in the provider's body table, as in <see cref="PropagationTarget.BodyIndex"/>.</param>
        /// <param name="fromUt">The instant the elements were sampled at.</param>
        /// <returns>The span in seconds, or <c>null</c> to refuse.</returns>
        double? BodySpanSeconds(int bodyIndex, double fromUt);
    }
}
