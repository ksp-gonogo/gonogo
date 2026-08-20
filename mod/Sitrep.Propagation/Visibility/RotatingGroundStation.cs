using System;
using Sitrep.Contract;

namespace Sitrep.Propagation.Visibility
{
    /// <summary>
    /// A fixed point on the surface of a spinning body, expressed in the same
    /// body-centred inertial frame the vessel's state vector lives in, at any UT.
    ///
    /// <para>The station does not move in the body's own frame; it moves in the
    /// inertial one, and that motion is half of what opens and closes a link.
    /// Position at a future UT is the surface normal rotated about +Z by the
    /// elapsed fraction of a rotation, scaled out to the surface:
    /// <c>n(UT) = Rz(2*pi*(UT-UT0)/period) * n0</c>,
    /// <c>P(UT) = n(UT) * (radius + altitude)</c>. Every KSP body spins about +Z
    /// (there is no axial tilt), so one axis covers every case.</para>
    ///
    /// <para><b>The rotation period is a parameter, never a constant.</b> KSP
    /// overwrites <c>rotationPeriod</c> for tidally-locked bodies to match their
    /// orbital period, so a value baked in from a wiki table is wrong for the Mun
    /// and for most moons. It must be read from the live body.</para>
    ///
    /// <para>A negative period is a retrograde spin and is handled by the sign
    /// falling through the formula. A zero or non-finite period means "no usable
    /// spin rate", and the station is held fixed in the inertial frame rather
    /// than being flung to NaN, so one bad field cannot poison a whole sweep.</para>
    /// </summary>
    public struct RotatingGroundStation
    {
        private readonly Vector3d _normalAtReference;
        private readonly double _referenceUt;
        private readonly double _rotationPeriodSeconds;
        private readonly double _distanceFromCentreMeters;

        /// <param name="surfaceNormalAtReferenceUt">Outward unit normal at the station, in the body-centred inertial frame, at <paramref name="referenceUt"/>. Normalised on construction; need not arrive normalised.</param>
        /// <param name="referenceUt">The UT at which <paramref name="surfaceNormalAtReferenceUt"/> was observed.</param>
        /// <param name="rotationPeriodSeconds">The body's sidereal rotation period, read live from the body.</param>
        /// <param name="bodyRadiusMeters">The body's mean radius. This is the SHAPE radius, which is not necessarily the occluding radius a comms backend applies.</param>
        /// <param name="altitudeMeters">Station altitude above that radius.</param>
        public RotatingGroundStation(
            Vector3d surfaceNormalAtReferenceUt,
            double referenceUt,
            double rotationPeriodSeconds,
            double bodyRadiusMeters,
            double altitudeMeters)
        {
            double magnitude = surfaceNormalAtReferenceUt.Magnitude();
            if (!(magnitude > 0.0) || double.IsNaN(magnitude) || double.IsInfinity(magnitude))
            {
                throw new ArgumentOutOfRangeException(
                    nameof(surfaceNormalAtReferenceUt),
                    "A ground station's surface normal must be a non-zero, finite vector; got " + surfaceNormalAtReferenceUt);
            }

            _normalAtReference = surfaceNormalAtReferenceUt * (1.0 / magnitude);
            _referenceUt = referenceUt;
            _rotationPeriodSeconds = rotationPeriodSeconds;
            _distanceFromCentreMeters = bodyRadiusMeters + altitudeMeters;
        }

        /// <summary>
        /// Build a station from body-fixed geodetic coordinates, given the body's
        /// prime-meridian orientation at <paramref name="referenceUt"/>.
        ///
        /// <para><paramref name="longitudeDegAtReferenceUt"/> is the INERTIAL
        /// longitude at the reference UT, i.e. the body-fixed longitude already
        /// added to however far the body had spun by then. Callers holding a plain
        /// body-fixed longitude plus a rotation angle add the two before calling.
        /// Keeping the sum on the caller's side is deliberate: KSP's
        /// <c>rotationAngle</c> convention is the sort of thing that is easy to
        /// get wrong silently, and burying an assumption about it here would hide
        /// the error inside geometry that otherwise has none.</para>
        /// </summary>
        public static RotatingGroundStation FromLatitudeLongitude(
            double latitudeDeg,
            double longitudeDegAtReferenceUt,
            double referenceUt,
            double rotationPeriodSeconds,
            double bodyRadiusMeters,
            double altitudeMeters)
        {
            double lat = latitudeDeg * Math.PI / 180.0;
            double lon = longitudeDegAtReferenceUt * Math.PI / 180.0;
            double cosLat = Math.Cos(lat);

            Vector3d normal = new Vector3d(cosLat * Math.Cos(lon), cosLat * Math.Sin(lon), Math.Sin(lat));
            return new RotatingGroundStation(normal, referenceUt, rotationPeriodSeconds, bodyRadiusMeters, altitudeMeters);
        }

        /// <summary>The body's sidereal rotation period as supplied, seconds. Negative is retrograde.</summary>
        public double RotationPeriodSeconds
        {
            get { return _rotationPeriodSeconds; }
        }

        /// <summary>Distance from the body's centre to the station, metres (radius + altitude).</summary>
        public double DistanceFromCentreMeters
        {
            get { return _distanceFromCentreMeters; }
        }

        /// <summary>The station's body-centred inertial position at <paramref name="ut"/>.</summary>
        public Vector3d PositionAt(double ut)
        {
            return NormalAt(ut) * _distanceFromCentreMeters;
        }

        /// <summary>The station's outward unit normal at <paramref name="ut"/>.</summary>
        public Vector3d NormalAt(double ut)
        {
            double angle = RotationAngleAt(ut);
            double cos = Math.Cos(angle);
            double sin = Math.Sin(angle);

            return new Vector3d(
                _normalAtReference.X * cos - _normalAtReference.Y * sin,
                _normalAtReference.X * sin + _normalAtReference.Y * cos,
                _normalAtReference.Z);
        }

        private double RotationAngleAt(double ut)
        {
            if (_rotationPeriodSeconds == 0.0
                || double.IsNaN(_rotationPeriodSeconds)
                || double.IsInfinity(_rotationPeriodSeconds))
            {
                return 0.0;
            }

            return 2.0 * Math.PI * (ut - _referenceUt) / _rotationPeriodSeconds;
        }
    }
}
