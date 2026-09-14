namespace Sitrep.Contract
{
    /// <summary>
    /// A provider that will say how far a BODY's published elements stay worth
    /// having.
    ///
    /// <para><b>Why this is separate from
    /// <see cref="IPropagationProvider.CanPropagate"/>, which already takes a
    /// window.</b> That member is asked by the machinery that COMPUTES a bound: the
    /// acceleration walk behind a craft's horizon places each perturbing body
    /// through it, so a provider that bounded a body there would refuse the walk its
    /// own answer is made of. Asking as a separate question leaves that path alone
    /// and gives the body catalogue somewhere to ask from.</para>
    ///
    /// <para><b>Why a body needs one at all, given a body is not a craft.</b> Under
    /// stock it does not: a body rides a fixed conic about a fixed parent, its place
    /// at a UT is a published fact, and a client evaluates it on demand at whatever
    /// instant it is drawing. Under n-body physics the elements on the wire are the
    /// conic tangent to an integrated path at the sample instant, for a moon exactly
    /// as for a craft, and a client carrying them forward without a limit draws a
    /// body where nobody said it would be. Only the force model can say how far, and
    /// only the Uplink that knows the install holds one.</para>
    ///
    /// <para>A marker with one member rather than a property on the provider
    /// interface, for the same reason <see cref="IIntegratedTrajectorySource"/> is a
    /// marker: a provider that has nothing to say about bodies says it by not being
    /// one of these, and cannot claim an unbounded ephemeris by omission.</para>
    /// </summary>
    public interface IBodyEphemerisHorizon
    {
        /// <summary>
        /// How many seconds past <paramref name="fromUt"/> this body's published
        /// elements are still worth having, or <c>null</c> when nothing can be said.
        ///
        /// <para>Null is the REFUSING answer and must stay distinguishable from a
        /// long span: it is what an install with no readable force model gets, and
        /// what a body the provider cannot place gets. A caller turns it into
        /// <see cref="PropagationHorizonKind.Unspecified"/> rather than into a
        /// number.</para>
        /// </summary>
        /// <param name="bodyIndex">The body, in the propagation seam's own vocabulary.</param>
        /// <param name="fromUt">The instant the elements were sampled at.</param>
        double? BodySpanSeconds(int bodyIndex, double fromUt);
    }
}
