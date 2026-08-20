using System;
using Sitrep.Contract;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// The one geometric primitive every occlusion question reduces to: does the
    /// straight line between two points pass through a sphere?
    ///
    /// <para>Two signed answers are offered, and the difference between them is
    /// load-bearing rather than cosmetic. <see cref="Clearance"/> is the
    /// segment-to-sphere distance in METRES, the quantity a human can reason about
    /// and compare against a radius. <see cref="HorizonMargin"/> answers the same
    /// yes/no question with a scalar that is fit to be ROOT-FOUND on. They agree
    /// on the sign for any pair of endpoints at or above the occluder's surface,
    /// which is asserted by test; the sweep uses the second and reports the
    /// first.</para>
    ///
    /// <para>Frame-agnostic: all three points must share one frame, and the caller
    /// owns which. In this codebase that is the Z-up parent-relative inertial
    /// frame <see cref="KeplerProvider"/> emits, never KSP world space.</para>
    /// </summary>
    public static class ChordOcclusion
    {
        /// <summary>
        /// Signed clearance, metres, of the segment <paramref name="a"/>-to-<paramref name="b"/>
        /// past a sphere of radius <paramref name="occluderRadiusMeters"/> centred
        /// at <paramref name="occluderCentre"/>: the distance from the sphere's
        /// centre to the nearest point ON THE SEGMENT, minus the radius.
        ///
        /// <para>Positive means the path is clear, negative means the rock is in
        /// the way, and zero is the exact tangent. The parameter is clamped to
        /// [0,1] so this is a segment test and not an infinite-line test: an
        /// occluder BEHIND one of the endpoints does not block a path that stops
        /// short of it, which is the difference between "Kerbin is between these
        /// two craft" and "Kerbin is somewhere along that bearing".</para>
        ///
        /// <para>This is the form the comms backends themselves use, and it is
        /// what makes a result explicable ("the beam passed 43 km inside a 600 km
        /// occluder"). What it is NOT is a good search variable: see
        /// <see cref="HorizonMargin"/>.</para>
        ///
        /// <para>Degenerate inputs are answered rather than thrown on: coincident
        /// endpoints collapse to a point-to-sphere distance, and a non-positive
        /// radius yields the raw distance (nothing occludes).</para>
        /// </summary>
        public static double Clearance(Vector3d a, Vector3d b, Vector3d occluderCentre, double occluderRadiusMeters)
        {
            Vector3d fromCentre = a - occluderCentre;
            Vector3d along = b - a;

            double lengthSquared = along.MagnitudeSquared();
            double t = lengthSquared > 0.0
                ? Clamp01(-Vector3d.Dot(fromCentre, along) / lengthSquared)
                : 0.0;

            Vector3d closest = fromCentre + along * t;
            return closest.Magnitude() - PositiveRadius(occluderRadiusMeters);
        }

        /// <summary>
        /// The same question as <see cref="Clearance"/>, signed the same way, but
        /// as <c>dot(A,B) + L(A)L(B) - R^2</c> where <c>L(P) = sqrt(|P|^2 - R^2)</c>
        /// is P's tangent length: units of metres SQUARED, zero exactly on the
        /// mutual horizon, and the scalar the sweep actually searches.
        ///
        /// <para>The reason for a second form is a degeneracy that breaks the
        /// first one precisely where this codebase needs it most. A ground station
        /// at zero altitude stands exactly ON an occluder whose radius is the
        /// body's own, which is the RealAntennas case. For every instant the
        /// vessel is above that station's horizon, the nearest point of the chord
        /// to the body's centre IS the station, so <see cref="Clearance"/> returns
        /// exactly zero, unchanging, across the whole visible arc. A quantity
        /// pinned at the decision boundary has no usable sign: in floating point
        /// it jitters either side of zero and a sweep reads dozens of
        /// acquisitions per orbit that never happened.</para>
        ///
        /// <para>This form has no flat region. It falls smoothly through zero as
        /// the vessel sets and rises smoothly back, so a bracket really does
        /// contain a crossing and bisection really does converge on it. It is
        /// also cheaper: two square roots, no clamping, no branches.</para>
        ///
        /// <para>An endpoint that has somehow sunk INSIDE the occluder is treated
        /// as though it were on the surface (its tangent length clamps to zero)
        /// rather than producing NaN from a negative square root. That keeps the
        /// function continuous everywhere, and the substituted answer is the
        /// conservative one.</para>
        /// </summary>
        public static double HorizonMargin(Vector3d a, Vector3d b, Vector3d occluderCentre, double occluderRadiusMeters)
        {
            double radius = PositiveRadius(occluderRadiusMeters);
            double radiusSquared = radius * radius;

            Vector3d fromCentreA = a - occluderCentre;
            Vector3d fromCentreB = b - occluderCentre;

            double tangentA = Math.Sqrt(Math.Max(0.0, fromCentreA.MagnitudeSquared() - radiusSquared));
            double tangentB = Math.Sqrt(Math.Max(0.0, fromCentreB.MagnitudeSquared() - radiusSquared));

            return Vector3d.Dot(fromCentreA, fromCentreB) + (tangentA * tangentB) - radiusSquared;
        }

        /// <summary>
        /// Whether the path is unobstructed, decided on <see cref="HorizonMargin"/>.
        ///
        /// <para>Clearance of zero or more counts as clear: blockage means
        /// penetrating the occluder's interior, and a path merely tangent to the
        /// surface does not. A station standing on the surface is the everyday
        /// instance of that, and requiring strict positivity would leave every one
        /// of them permanently dark.</para>
        /// </summary>
        public static bool IsClear(Vector3d a, Vector3d b, Vector3d occluderCentre, double occluderRadiusMeters)
        {
            return Unobstructed(HorizonMargin(a, b, occluderCentre, occluderRadiusMeters));
        }

        /// <summary>
        /// The sign convention above, applied to a margin that has already been
        /// computed. It lives here, alone, because <see cref="VisibilitySweep"/>
        /// tests the same sign on every sample and on every bisection step: two
        /// copies of this comparison that disagreed by one <c>=</c> would put the
        /// refiner on the other side of the horizon from the sweep that bracketed
        /// it.
        /// </summary>
        public static bool Unobstructed(double margin)
        {
            return margin >= 0.0;
        }

        private static double PositiveRadius(double occluderRadiusMeters)
        {
            return occluderRadiusMeters > 0.0 ? occluderRadiusMeters : 0.0;
        }

        private static double Clamp01(double value)
        {
            if (double.IsNaN(value))
            {
                return 0.0;
            }

            return value < 0.0 ? 0.0 : (value > 1.0 ? 1.0 : value);
        }
    }
}
