using System;
using Sitrep.Contract;

// The vectors below are written out in full because KSP ships its own global
// Vector3d, which wins the unqualified name whenever this assembly is compiled
// against the game and cannot be aliased away. Unqualified, every signature here
// would silently be the game's type: it compiles headless and stops compiling the
// moment the KSP assemblies are in front of it.
namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// One body this Uplink will sum when it bounds a craft's osculating elements:
    /// where to ask the displaced solver for it, and what the force model calls it.
    ///
    /// <para>Two keys because two different tables are being joined. The INDEX is
    /// the propagation seam's vocabulary, and the only way to ask where a body is
    /// without carrying a second copy of two-body motion. The NAME is the gravity
    /// model's, which is configuration the producer ships and is keyed on nothing
    /// else. A body the model does not name is dropped from the sum rather than
    /// guessed at.</para>
    /// </summary>
    public readonly struct PrincipiaPerturber
    {
        public PrincipiaPerturber(string name, int bodyIndex)
        {
            Name = name;
            BodyIndex = bodyIndex;
        }

        public string Name { get; }

        public int BodyIndex { get; }
    }

    /// <summary>
    /// What this craft's neighbourhood does to it, gathered one body at a time and
    /// held as the harmonics of the craft's own orbital phase.
    ///
    /// <para><b>Why harmonics and not a number.</b> A perturber's differential pull
    /// is <c>A [3 (r̂·n̂) n̂ − r̂]</c>, so as the craft goes round, the radial and
    /// along-track components of that pull sweep at TWICE the orbital rate and the
    /// cross-track one at the orbital rate. Those three are the only frequencies in
    /// it. Summing magnitudes throws all of that away and leaves a scalar that
    /// cannot tell a pull along the track, which changes the craft's ENERGY and
    /// therefore its period, from one straight up, which largely does not.</para>
    ///
    /// <para><b>Each body's SIZE comes from its exact pull, its SHAPE from the
    /// expansion.</b> The <c>(r/d)</c> expansion the tide is a first term of is only
    /// good while the craft is deep inside its primary's neighbourhood, and the
    /// relays in the save that fixed these numbers sit at a fifth of the way out to
    /// the Mun, where it is already several per cent light. So the amplitude is
    /// rescaled to the difference of the two real pulls at the sample instant, and
    /// only the direction structure is taken from the expansion.</para>
    ///
    /// <para>Bodies are added rather than passed in a list because the caller is
    /// already walking the neighbourhood through the displaced solver, one
    /// <c>CanPropagate</c> and one <c>Solve</c> at a time, and a body it cannot place
    /// is skipped rather than guessed at.</para>
    /// </summary>
    public sealed class TidalForcing
    {
        private readonly Sitrep.Contract.Vector3d _radial;
        private readonly Sitrep.Contract.Vector3d _alongTrack;
        private readonly Sitrep.Contract.Vector3d _crossTrack;
        private readonly Sitrep.Contract.Vector3d _position;
        private readonly double _radius;

        private double _c0, _c1, _c2, _d1, _d2, _e1, _e2;

        /// <param name="craft">
        /// Where the craft is and where it is going, in the frame centred on its
        /// primary. The velocity is not decoration: it is the only thing that tells
        /// along-track from cross-track, and the whole reason a direction-aware bound
        /// can be computed at all.
        /// </param>
        public TidalForcing(StateVector craft)
        {
            _position = craft.Position;
            _radius = _position.Magnitude();
            if (!(_radius > 0.0) || double.IsInfinity(_radius))
            {
                return;
            }

            var h = Cross(craft.Position, craft.Velocity);
            var hMagnitude = h.Magnitude();
            if (!(hMagnitude > 0.0) || double.IsInfinity(hMagnitude))
            {
                return;
            }

            _radial = _position * (1.0 / _radius);
            _crossTrack = h * (1.0 / hMagnitude);
            _alongTrack = Cross(_crossTrack, _radial);
            HasFrame = true;
        }

        /// <summary>Whether a radial/along-track/cross-track frame could be built at all.</summary>
        public bool HasFrame { get; }

        /// <summary>Whether any body has been summed into this.</summary>
        public bool Any { get; private set; }

        /// <summary>
        /// The largest <c>craft radius / perturber distance</c> summed, which is the
        /// quantity the tide is an expansion IN and therefore the one that says when
        /// it has stopped being true. See
        /// <see cref="PrincipiaHorizonBound.NearFieldRatio"/>.
        /// </summary>
        public double NearestRatio { get; private set; }

        /// <summary>
        /// The sum of each body's worst-case tidal magnitude, <c>2 mu r / d^3</c>:
        /// the direction-blind quantity, kept because it is what the bound falls back
        /// to where the expansion behind everything else here does not hold.
        /// </summary>
        public double WorstCaseAcceleration { get; private set; }

        /// <summary>
        /// Sum one body in. A body with no usable distance or mass is dropped rather
        /// than allowed to poison the accumulation, the same rule
        /// <see cref="PrincipiaHorizonBound.PerturbingAcceleration"/> applies.
        /// </summary>
        public void Add(Sitrep.Contract.Vector3d perturberPosition, double perturberMu)
        {
            if (!HasFrame) return;
            var d = perturberPosition.Magnitude();
            if (!(d > 0.0) || !(perturberMu > 0.0)
                || double.IsInfinity(d) || double.IsInfinity(perturberMu))
            {
                return;
            }

            var amplitude = perturberMu * _radius / (d * d * d);
            if (!(amplitude > 0.0) || double.IsInfinity(amplitude)) return;

            var nx = Sitrep.Contract.Vector3d.Dot(perturberPosition, _radial) / d;
            var ny = Sitrep.Contract.Vector3d.Dot(perturberPosition, _alongTrack) / d;
            var nz = Sitrep.Contract.Vector3d.Dot(perturberPosition, _crossTrack) / d;

            // The expansion's own value at this instant, against the difference of
            // the two real pulls. Their ratio is what the expansion is light by here,
            // and rescaling by it costs one more square root per body.
            var toBody = perturberPosition - _position;
            var separation = toBody.Magnitude();
            if (!(separation > 0.0) || double.IsInfinity(separation)) return;
            var exact = (toBody * (perturberMu / (separation * separation * separation))
                         - perturberPosition * (perturberMu / (d * d * d))).Magnitude();
            var approximated = amplitude * Math.Sqrt(
                (3.0 * nx * nx - 1.0) * (3.0 * nx * nx - 1.0)
                + 9.0 * nx * nx * ny * ny
                + 9.0 * nx * nx * nz * nz);
            if (approximated > 0.0 && !double.IsInfinity(exact) && !double.IsNaN(exact))
            {
                amplitude *= exact / approximated;
            }
            if (!(amplitude > 0.0) || double.IsInfinity(amplitude)) return;

            var inPlane = nx * nx + ny * ny;
            _c0 += amplitude * (1.5 * inPlane - 1.0);
            _c1 += 1.5 * amplitude * (nx * nx - ny * ny);
            _c2 += 3.0 * amplitude * nx * ny;
            _d1 += 3.0 * amplitude * nx * ny;
            _d2 += -1.5 * amplitude * (nx * nx - ny * ny);
            _e1 += 3.0 * amplitude * nz * nx;
            _e2 += 3.0 * amplitude * nz * ny;

            WorstCaseAcceleration +=
                PrincipiaHorizonBound.PerturbingAcceleration(_radius, perturberMu, d);
            var ratio = _radius / d;
            if (ratio > NearestRatio) NearestRatio = ratio;
            Any = true;
        }

        /// <summary>
        /// How far the published conic is from the path it is tangent to, this many
        /// seconds after the sample instant.
        ///
        /// <para>The two curves share a state at <c>t = 0</c> by construction, so
        /// their difference starts at rest and is driven only by the perturbation and
        /// by the primary's own gravity gradient. That is the linearised relative
        /// motion about a circular orbit, and with the forcing above it solves in
        /// closed form: the in-plane pair reduces to <c>x'' + x = f_r + 2 ∫f_t</c>
        /// with the along-track offset following from <c>x</c>, and the cross-track
        /// equation is driven exactly at its own natural frequency, which is why that
        /// term grows with <c>t</c> rather than oscillating.</para>
        ///
        /// <para>The along-track secular term is LINEAR in time here, where a
        /// perturbation held fixed in the rotating frame would give a quadratic one.
        /// That difference is the whole reason the harmonics are carried: measured
        /// against a live save, treating the pull as fixed overstates the departure by
        /// up to six and a half times.</para>
        /// </summary>
        public double DepartureMetres(double meanMotion, double seconds)
        {
            if (!HasFrame || !(meanMotion > 0.0) || double.IsInfinity(meanMotion))
            {
                return double.NaN;
            }

            var u = meanMotion * seconds;
            var su = Math.Sin(u);
            var cu = Math.Cos(u);
            var s2 = Math.Sin(2.0 * u);
            var c2 = Math.Cos(2.0 * u);

            var p = _c0 + _d2;
            var q = _c1 - _d2;
            var r = _c2 + _d1;

            var x = p * (1.0 - cu)
                    - (q / 3.0) * (c2 - cu)
                    - (r / 3.0) * s2
                    + (2.0 * r / 3.0) * su;
            var y = -2.0 * (p * (u - su)
                            - (q / 3.0) * (0.5 * s2 - su)
                            - (r / 6.0) * (1.0 - c2)
                            + (2.0 * r / 3.0) * (1.0 - cu))
                    + (_d1 / 4.0) * (1.0 - c2)
                    + (_d2 / 2.0) * u
                    - (_d2 / 4.0) * s2;
            var z = _e1 * 0.5 * u * su + _e2 * (0.5 * su - 0.5 * u * cu);

            return Math.Sqrt(x * x + y * y + z * z) / (meanMotion * meanMotion);
        }

        private static Sitrep.Contract.Vector3d Cross(
            Sitrep.Contract.Vector3d a, Sitrep.Contract.Vector3d b) =>
            new Sitrep.Contract.Vector3d(
                a.Y * b.Z - a.Z * b.Y,
                a.Z * b.X - a.X * b.Z,
                a.X * b.Y - a.Y * b.X);
    }

    /// <summary>
    /// How long this Uplink will vouch for a craft's published osculating elements.
    ///
    /// <para><b>The bound is a LOCAL property and this is what makes it one.</b>
    /// Under n-body physics the elements on the wire are the conic tangent to the
    /// path at the sample instant, and they part company with the path at a rate set
    /// by the perturbing acceleration where that craft actually is, and by which WAY
    /// that acceleration points relative to the craft's own motion. Nothing outside
    /// the force model can compute either, which is why the answer belongs here
    /// rather than in core.</para>
    ///
    /// <para><b>Measured, not derived.</b> Every constant below was fixed against a
    /// live save on the rig on 2026-09-05: the mod's own published arc for the active
    /// craft was reproduced to 0.20 m over 655 s, then the departure of the conic
    /// from the integrated path was measured for every orbiting vessel in the save at
    /// eight phases each, and again over 1472 synthetic orbits on the same real body
    /// geometry to reach the eccentricities and inclinations the save does not
    /// contain.</para>
    ///
    /// <para><b>The measurement that produced the previous constants was
    /// instrument error.</b> They were taken by comparing the two-body extrapolation
    /// against the mod's own published arc, which is velocity Verlet at 300 steps per
    /// revolution: run with NO perturbers in the model at all, that integrator walks
    /// 106 m away from the conic it started on in 700 s, which is the whole quantity
    /// the measurement was of. The departures it reported were therefore mostly its
    /// own truncation, the along-track "amplification" of 1.1 to 3.7 was the ratio
    /// between that truncation and the real tide rather than a property of either,
    /// and every crossing it named was between 1.5 and 8 times too early. The
    /// measurement behind the numbers here integrates the DIFFERENCE between the two
    /// curves instead, with the conic in closed form, so the central term never
    /// enters the truncation: with no perturbers it reports zero.</para>
    /// </summary>
    public static class PrincipiaHorizonBound
    {
        /// <summary>
        /// How far the published conic may be from the path it is tangent to before
        /// this Uplink stops vouching for it, metres.
        ///
        /// <para>A hundred metres is a judgement about what a client can be shown
        /// without being misled, and it is the one thing here that is not derived
        /// from anything: it is the width of the curve on any diagram anybody will
        /// draw from these elements. Naming the tolerance rather than a fraction of a
        /// cycle is what lets every craft scale away from it.</para>
        /// </summary>
        public const double ToleranceMetres = 100.0;

        /// <summary>
        /// The margin the published span carries under the instant the departure law
        /// says the conic reaches <see cref="ToleranceMetres"/>.
        ///
        /// <para>Across 1552 measured samples inside the law's stated domain, the
        /// worst it overstated the real crossing by was 1.117, and its median was
        /// 0.997: it PREDICTS the departure rather than bounding it, so a bound has
        /// to put a margin on top. A half is that worst case with a third again over
        /// it, which is the room a law validated against one save should be given.
        /// Raising it shortens every horizon in proportion and is the one number to
        /// move to trade arc length for margin.</para>
        /// </summary>
        public const double SafetyFactor = 1.5;

        /// <summary>
        /// The largest <c>craft radius / perturber distance</c> at which the tidal
        /// expansion is trusted.
        ///
        /// <para>Everything in <see cref="TidalForcing"/> is first order in that
        /// ratio. Measured, the law holds to 1.11 at a half and degrades to 1.38 at
        /// three quarters and 4.8 by the time a craft is out past the perturber
        /// itself, which is where a Minmus transfer or a Jool-system craft sits. A
        /// half is the last bucket that stays inside the margin above.</para>
        /// </summary>
        public const double NearFieldRatio = 0.5;

        /// <summary>
        /// The largest eccentricity at which the departure law is trusted.
        ///
        /// <para>The relative-motion equations behind it are the circular-orbit ones,
        /// and they take the mean motion for the craft's actual angular rate. Near the
        /// periapsis of an eccentric orbit those are not the same number: measured,
        /// the law is still inside its margin at a half and overstates by 1.51 at
        /// seven tenths. Every craft in the save that fixed these numbers is under
        /// 0.002, so this is a limit on cases nobody in it flies.</para>
        /// </summary>
        public const double NearFieldEccentricity = 0.5;

        /// <summary>
        /// What the direction-blind fallback divides its kinematic span by, outside
        /// the domain above.
        ///
        /// <para>Past that domain there is no first-order law left to compute, so the
        /// bound falls back to the double integral of the worst-case tidal magnitude
        /// and a flat divisor, which is what this whole file used to be. Five rather
        /// than the four it used to carry: measured over the same samples, four
        /// overstates a Kerbin craft at seven tenths eccentricity whose apoapsis
        /// reaches past the Mun by 1.16, so the old constant was not safe out here
        /// either.</para>
        /// </summary>
        public const double FarFieldAmplification = 5.0;

        /// <summary>
        /// The most of a craft's own cycle this will vouch for however calm its
        /// neighbourhood, and the reason there is a ceiling at all.
        ///
        /// <para>The neighbourhood is read where the craft is NOW. The departure law
        /// carries the craft's own phase forward but holds every perturber still, so
        /// a window long enough for the perturbers themselves to have moved is one the
        /// sample it was computed from no longer describes. A quarter is also the
        /// fraction core used to apply unconditionally, which keeps this a ceiling
        /// nothing can be published above.</para>
        /// </summary>
        public const double CycleCeilingFraction = 0.25;

        /// <summary>Scan points across the search window before the crossing is bisected.</summary>
        private const int ScanSteps = 128;

        /// <summary>Bisection steps once a crossing has been bracketed.</summary>
        private const int RefineSteps = 40;

        /// <summary>
        /// One perturber's differential (tidal) acceleration across the craft's
        /// orbit, in metres per second squared, at its worst orientation. Zero for a
        /// body whose distance or mass is not a usable number, which drops the term
        /// rather than poisoning the sum.
        /// </summary>
        public static double PerturbingAcceleration(
            double craftRadius, double perturberMu, double perturberDistance)
        {
            if (!(craftRadius > 0.0) || !(perturberMu > 0.0) || !(perturberDistance > 0.0)
                || double.IsInfinity(craftRadius) || double.IsInfinity(perturberMu)
                || double.IsInfinity(perturberDistance))
            {
                return 0.0;
            }
            return 2.0 * perturberMu * craftRadius
                / (perturberDistance * perturberDistance * perturberDistance);
        }

        /// <summary>
        /// How many seconds past the sample instant these elements are still worth
        /// <see cref="ToleranceMetres"/>, or <c>null</c> when nothing can be said.
        ///
        /// <para>Null is the refusing answer, and it is what a craft with no cycle
        /// and no measurable perturber gets: the first leaves no scale to state a
        /// ceiling in, the second leaves no rate to divide the tolerance by, and
        /// together they leave nothing to compute. Inventing a span there is the
        /// failure this whole seam exists to prevent.</para>
        ///
        /// <para>The departure is not monotonic in time, which is why the crossing is
        /// scanned for rather than solved: a tide that is pulling the craft outward
        /// now will be pulling it inward half a revolution later, and the offset it
        /// built can come back. What the bound needs is the FIRST instant the
        /// tolerance is reached, and a solver that assumed one crossing would happily
        /// name a later one.</para>
        /// </summary>
        public static double? SpanSeconds(
            TidalForcing? forcing, double eccentricity, double? characteristicCycleSeconds)
        {
            double? ceiling = null;
            double meanMotion = 0.0;
            var cycle = characteristicCycleSeconds;
            if (cycle != null && cycle.Value > 0.0
                && !double.IsNaN(cycle.Value) && !double.IsInfinity(cycle.Value))
            {
                ceiling = cycle.Value * CycleCeilingFraction;
                meanMotion = 2.0 * Math.PI / cycle.Value;
            }

            if (forcing == null || !forcing.Any)
            {
                // Nothing measurable is pulling on it, so the elements are as good as
                // two-body ones and the ceiling is the whole of what we will say.
                return ceiling;
            }

            if (forcing.HasFrame
                && meanMotion > 0.0
                && ceiling != null
                && forcing.NearestRatio <= NearFieldRatio
                && IsInsideEccentricityDomain(eccentricity))
            {
                var crossing = FirstCrossing(forcing, meanMotion, ceiling.Value * SafetyFactor);
                var computed = crossing == null ? ceiling.Value : crossing.Value / SafetyFactor;
                return Math.Min(computed, ceiling.Value);
            }

            return FarFieldSpan(forcing.WorstCaseAcceleration, ceiling);
        }

        /// <summary>
        /// The direction-blind span: the double integral of the worst-case tidal
        /// magnitude, divided by <see cref="FarFieldAmplification"/>. Public because
        /// it is a complete answer on its own for a craft whose neighbourhood the
        /// expansion cannot describe, and because a test that cannot reach it cannot
        /// show it is the shorter of the two.
        /// </summary>
        public static double? FarFieldSpan(double perturbingAcceleration, double? ceiling)
        {
            if (!(perturbingAcceleration > 0.0) || double.IsInfinity(perturbingAcceleration))
            {
                return ceiling;
            }

            var span = Math.Sqrt(2.0 * ToleranceMetres / perturbingAcceleration)
                / FarFieldAmplification;
            if (double.IsNaN(span) || double.IsInfinity(span))
            {
                return ceiling;
            }
            return ceiling == null ? span : Math.Min(span, ceiling.Value);
        }

        private static bool IsInsideEccentricityDomain(double eccentricity) =>
            !double.IsNaN(eccentricity)
            && eccentricity >= 0.0
            && eccentricity <= NearFieldEccentricity;

        /// <summary>
        /// The first instant inside <paramref name="limit"/> at which the departure
        /// reaches the tolerance, or null when it never does.
        /// </summary>
        private static double? FirstCrossing(
            TidalForcing forcing, double meanMotion, double limit)
        {
            var previousTime = 0.0;
            for (var i = 1; i <= ScanSteps; i++)
            {
                var t = limit * i / ScanSteps;
                var departure = forcing.DepartureMetres(meanMotion, t);
                if (double.IsNaN(departure)) return null;
                if (departure >= ToleranceMetres)
                {
                    var low = previousTime;
                    var high = t;
                    for (var step = 0; step < RefineSteps; step++)
                    {
                        var mid = 0.5 * (low + high);
                        if (forcing.DepartureMetres(meanMotion, mid) >= ToleranceMetres)
                        {
                            high = mid;
                        }
                        else
                        {
                            low = mid;
                        }
                    }
                    return high;
                }
                previousTime = t;
            }
            return null;
        }
    }
}
