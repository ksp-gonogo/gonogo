using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Declares that a value is deterministic for as long as a sibling
    /// horizon says so: its place at any instant is exact, computed from fixed
    /// inputs and the clock, so a figure drawn from it is never a guess and
    /// carries no held or modelled mark.
    ///
    /// <para>A body's orbital elements under stock physics are the case. The
    /// body rides a fixed conic about a fixed parent, so where it is at any UT
    /// is a published fact. They are not <see cref="SitrepStaticAttribute"/>:
    /// the body moves, and a phase angle between two of them changes every
    /// second. What holds is weaker and still exact, that the value at an
    /// instant nobody observed can be computed with no error.</para>
    ///
    /// <para>Unlike static, it is conditional. The guarantee is the physics
    /// model's, and an n-body install withdraws it: the elements are then the
    /// conic osculating an integrated ephemeris and drift like a craft's. So the
    /// attribute names the sibling
    /// <see cref="PropagationHorizon"/> that carries the elected provider's own
    /// statement, and the value is deterministic only while that horizon is
    /// <see cref="PropagationHorizonKind.Unbounded"/> and
    /// <see cref="TrajectoryKind.Analytic"/>. A payload with no horizon at all
    /// reads as deterministic.</para>
    ///
    /// <para>It goes on the property that holds the value or a shape of values.
    /// Placed on a nested shape (a body's <c>Orbit</c>), every quantity inside it
    /// takes the stamp, and the same shape under another parent (a vessel's orbit
    /// in the roster) is untouched.</para>
    ///
    /// <para>Unlike a static stamp, this one survives derivation: a figure
    /// computed only from static and deterministic values and the clock is itself
    /// deterministic, and one input that is neither makes the result
    /// neither.</para>
    /// <internal>A payload with no horizon comes from a host older than the
    /// field, which is a stock install.</internal>
    /// </summary>
    /// <category>Propagation and models</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepDeterministicWhileAttribute : Attribute
    {
        /// <summary>The sibling property, a <see cref="PropagationHorizon"/>, whose Unbounded and Analytic state makes this value deterministic.</summary>
        public string Horizon { get; }

        /// <param name="horizon">The name of the sibling <see cref="PropagationHorizon"/> property, by <c>nameof</c>.</param>
        public SitrepDeterministicWhileAttribute(string horizon)
        {
            Horizon = horizon;
        }
    }
}
