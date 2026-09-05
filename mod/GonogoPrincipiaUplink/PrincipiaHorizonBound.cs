using System;
using System.Collections.Generic;
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
    /// How far the published conic has drifted from the path the craft actually
    /// flies, integrated rather than estimated.
    ///
    /// <para><b>The DIFFERENCE of the two curves is the thing integrated, and that
    /// is what makes the answer readable at all.</b> Integrate the perturbed path and
    /// the conic separately and subtract, and what comes out is a hundred metres of
    /// signal on top of a million metres of orbit: an integrator good to a part in ten
    /// million reports its own truncation and nothing else, which is how this file
    /// came to carry a constant of four. Integrating the difference leaves the central
    /// term out of the truncation entirely, and with no perturbers in the model the
    /// answer is zero to the last bit rather than a hundred metres.</para>
    ///
    /// <para><b>Nothing here is expanded and nothing is held still.</b> Both curves
    /// are asked of the displaced solver at each step: the craft's own conic, and each
    /// perturber's place in the primary's frame. So the differential pull is the exact
    /// difference of two real pulls rather than the first term of an expansion in
    /// <c>r/d</c>, the craft's motion is its actual conic rather than a circle, and
    /// the perturbers move. Those three approximations were what the previous form's
    /// stated domain was about, and taking them out is what removes it: that form held
    /// inside <c>r/d &lt;= 0.5</c> and <c>ecc &lt;= 0.5</c> and broke to 4.8 outside,
    /// where this holds to <b>1.0003</b> over 928 measured orbits reaching <c>r/d</c>
    /// of 3.1 and eccentricity 0.9.</para>
    ///
    /// <para>Bodies are added one at a time rather than passed in a list because the
    /// caller is already walking the neighbourhood through the displaced solver, and a
    /// body it cannot place is skipped rather than guessed at.</para>
    /// </summary>
    public sealed class ConicDeparture
    {
        private readonly Func<double, Sitrep.Contract.Vector3d>? _conic;
        private readonly double _primaryMu;
        private readonly double _fromUt;
        private readonly double _initialRadius;
        private readonly List<double> _mu = new List<double>();
        private readonly List<Func<double, Sitrep.Contract.Vector3d>> _where =
            new List<Func<double, Sitrep.Contract.Vector3d>>();

        /// <param name="primaryMu">
        /// The gravitational parameter of the body the craft orbits: the central term
        /// both curves share, and therefore the one whose gradient bends their
        /// difference.
        /// </param>
        /// <param name="fromUt">The instant at which the two curves share a state.</param>
        /// <param name="conic">
        /// Where the published conic puts the craft, in the primary's frame, at any
        /// UT. Asked of the displaced solver rather than propagated here: a second
        /// copy of two-body motion inside this Uplink is the duplication the
        /// propagation seam exists to prevent.
        /// </param>
        public ConicDeparture(
            double primaryMu, double fromUt, Func<double, Sitrep.Contract.Vector3d>? conic)
        {
            _primaryMu = primaryMu;
            _fromUt = fromUt;
            _conic = conic;
            if (conic == null || !(primaryMu > 0.0) || double.IsInfinity(primaryMu)
                || double.IsNaN(fromUt) || double.IsInfinity(fromUt))
            {
                return;
            }

            var start = conic(fromUt);
            if (!IsFinite(start)) return;
            _initialRadius = start.Magnitude();
            if (!(_initialRadius > 0.0) || double.IsInfinity(_initialRadius)) return;
            HasCraft = true;
        }

        /// <summary>Whether there is a craft and a primary to depart from at all.</summary>
        public bool HasCraft { get; }

        /// <summary>Whether any body has been summed into this.</summary>
        public bool Any => _where.Count > 0;

        /// <summary>
        /// The sum of each body's worst-case tidal magnitude at the sample instant,
        /// <c>2 mu r / d^3</c>. Nothing in the integration uses it: it is the
        /// direction-blind quantity the bound falls back to for a craft with no
        /// repeat, where there is no scale to search over.
        /// </summary>
        public double WorstCaseAcceleration { get; private set; }

        /// <summary>
        /// Sum one body in. A body with no usable mass, or one the solver puts
        /// nowhere, is dropped rather than allowed to poison the accumulation.
        /// </summary>
        public void Add(double perturberMu, Func<double, Sitrep.Contract.Vector3d>? where)
        {
            if (!HasCraft || where == null) return;
            if (!(perturberMu > 0.0) || double.IsInfinity(perturberMu)) return;

            var at = where(_fromUt);
            if (!IsFinite(at)) return;
            var d = at.Magnitude();
            if (!(d > 0.0) || double.IsInfinity(d)) return;

            _mu.Add(perturberMu);
            _where.Add(where);
            WorstCaseAcceleration += PrincipiaHorizonBound.PerturbingAcceleration(
                _initialRadius, perturberMu, d);
        }

        /// <summary>
        /// How far the conic has drifted from the path, this many seconds after the
        /// sample instant, stepped at <paramref name="stepSeconds"/>. <c>NaN</c> when
        /// there is nothing to integrate.
        /// </summary>
        public double MetresAt(double seconds, double stepSeconds)
        {
            if (!HasCraft || double.IsNaN(seconds) || double.IsInfinity(seconds)
                || !(stepSeconds > 0.0) || double.IsInfinity(stepSeconds))
            {
                return double.NaN;
            }
            if (seconds <= 0.0) return 0.0;

            var run = new Run(this);
            var steps = (int)Math.Ceiling(seconds / stepSeconds);
            var h = seconds / steps;
            for (var i = 0; i < steps; i++)
            {
                run.Advance(h, run.AccelerationNow());
            }
            return run.Departure;
        }

        /// <summary>
        /// The first instant inside <paramref name="window"/> at which the departure
        /// reaches <paramref name="tolerance"/>, or null when it does not.
        ///
        /// <para>Scanned rather than solved, because the departure is not monotonic:
        /// a tide pulling the craft outward now pulls it back half a revolution
        /// later, and the offset it built can come back. What a bound needs is the
        /// FIRST instant the tolerance is reached, and a solver that assumed one
        /// crossing would happily name a later one.</para>
        /// </summary>
        public double? FirstCrossingSeconds(double window, double tolerance, int steps)
        {
            if (!HasCraft || !(window > 0.0) || double.IsInfinity(window)
                || !(tolerance > 0.0) || steps < 1)
            {
                return null;
            }

            var h = window / steps;
            var run = new Run(this);
            for (var i = 0; i < steps; i++)
            {
                var before = run.Snapshot();
                run.Advance(h, run.AccelerationNow());
                var departure = run.Departure;
                if (double.IsNaN(departure))
                {
                    // The offset has reached the centre it is measured from, which is
                    // past any tolerance. The last instant still describable is the
                    // answer; naming a later one would be inventing it.
                    return before.Time > 0.0 ? before.Time : (double?)null;
                }
                if (departure >= tolerance)
                {
                    return Bracket(before, h, tolerance);
                }
            }
            return null;
        }

        /// <summary>Where inside one step the tolerance was first reached.</summary>
        private double Bracket(State before, double taken, double tolerance)
        {
            var low = 0.0;
            var high = 1.0;
            for (var step = 0; step < PrincipiaHorizonBound.RefineSteps; step++)
            {
                var mid = 0.5 * (low + high);
                var probe = new Run(this, before);
                probe.Advance(taken * mid, probe.AccelerationNow());
                var d = probe.Departure;
                if (double.IsNaN(d) || d >= tolerance) high = mid;
                else low = mid;
            }
            return before.Time + taken * high;
        }

        private static bool IsFinite(Sitrep.Contract.Vector3d v) =>
            !double.IsNaN(v.X) && !double.IsInfinity(v.X)
            && !double.IsNaN(v.Y) && !double.IsInfinity(v.Y)
            && !double.IsNaN(v.Z) && !double.IsInfinity(v.Z);

        /// <summary>The integrator's state between steps, so a step can be retaken.</summary>
        private readonly struct State
        {
            public State(
                double time,
                Sitrep.Contract.Vector3d offset,
                Sitrep.Contract.Vector3d rate)
            {
                Time = time;
                Offset = offset;
                Rate = rate;
            }

            public double Time { get; }

            public Sitrep.Contract.Vector3d Offset { get; }

            public Sitrep.Contract.Vector3d Rate { get; }
        }

        /// <summary>
        /// One integration of the departure, stepped classically fourth-order at a
        /// fixed fraction of the craft's own revolution.
        ///
        /// <para>A fixed step is enough because the only frequencies in a tide are the
        /// orbital rate and twice it, so nothing in the equation is faster than the
        /// orbit itself. An adaptive bound on the step was measured against 928 orbits
        /// reaching a craft radius three times the perturber's own distance, and moved
        /// no crossing by more than a part in a hundred thousand; it went rather than
        /// ship a constant that earns nothing.</para>
        /// </summary>
        private sealed class Run
        {
            private readonly ConicDeparture _owner;
            private Sitrep.Contract.Vector3d _offset;
            private Sitrep.Contract.Vector3d _rate;
            private double _cachedUt = double.NaN;
            private Sitrep.Contract.Vector3d _cachedConic;
            private Sitrep.Contract.Vector3d[]? _cachedBodies;

            public Run(ConicDeparture owner)
                : this(owner,
                    new State(0.0, new Sitrep.Contract.Vector3d(0, 0, 0),
                        new Sitrep.Contract.Vector3d(0, 0, 0)))
            {
            }

            public Run(ConicDeparture owner, State from)
            {
                _owner = owner;
                Time = from.Time;
                _offset = from.Offset;
                _rate = from.Rate;
            }

            public double Time { get; private set; }

            public double Departure => _offset.Magnitude();

            public State Snapshot() => new State(Time, _offset, _rate);

            public Sitrep.Contract.Vector3d AccelerationNow() => Acceleration(Time, _offset);

            public void Advance(double h, Sitrep.Contract.Vector3d a1)
            {
                var d2 = _offset + _rate * (0.5 * h);
                var a2 = Acceleration(Time + 0.5 * h, d2);
                var v2 = _rate + a1 * (0.5 * h);
                var d3 = _offset + v2 * (0.5 * h);
                var a3 = Acceleration(Time + 0.5 * h, d3);
                var v3 = _rate + a2 * (0.5 * h);
                var d4 = _offset + v3 * h;
                var a4 = Acceleration(Time + h, d4);
                var v4 = _rate + a3 * h;

                _offset = _offset + (_rate + (v2 + v3) * 2.0 + v4) * (h / 6.0);
                _rate = _rate + (a1 + (a2 + a3) * 2.0 + a4) * (h / 6.0);
                Time += h;
            }

            /// <summary>
            /// What bends the two curves apart at this instant: the primary's own
            /// gravity gradient across the offset, plus every perturber's pull on the
            /// craft LESS its pull on the primary, because the frame is centred on the
            /// primary and is therefore accelerating. Dropping that second half is the
            /// classic error, and it leaves a term that does not vanish as the
            /// perturber recedes.
            ///
            /// <para>Where everything is at one instant is held for one instant,
            /// because the four stages of a step ask for three times between them and
            /// the last of those is the first of the next step. Without it every step
            /// costs four walks of the neighbourhood instead of two.</para>
            /// </summary>
            private Sitrep.Contract.Vector3d Acceleration(
                double seconds, Sitrep.Contract.Vector3d offset)
            {
                var ut = _owner._fromUt + seconds;
                if (!ut.Equals(_cachedUt))
                {
                    _cachedUt = ut;
                    _cachedConic = _owner._conic!(ut);
                    if (_cachedBodies == null || _cachedBodies.Length != _owner._where.Count)
                    {
                        _cachedBodies = new Sitrep.Contract.Vector3d[_owner._where.Count];
                    }
                    for (var i = 0; i < _owner._where.Count; i++)
                    {
                        _cachedBodies[i] = _owner._where[i](ut);
                    }
                }

                var gradient = PrincipiaHorizonBound.InverseCubeDifference(_cachedConic, offset);
                var total = gradient * -_owner._primaryMu;
                var craft = _cachedConic + offset;
                var away = new Sitrep.Contract.Vector3d(-craft.X, -craft.Y, -craft.Z);
                for (var i = 0; i < _owner._where.Count; i++)
                {
                    var term = PrincipiaHorizonBound.InverseCubeDifference(
                        _cachedBodies![i], away);
                    total = total + term * _owner._mu[i];
                }
                return total;
            }
        }
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
    /// <para><b>It is now computed rather than approximated, and that is what took
    /// the ceiling off.</b> Two earlier forms of this file each carried a fraction of
    /// the craft's own cycle as an upper bound, and each carried it for the same
    /// reason: the arithmetic underneath was an expansion evaluated at one instant, so
    /// a window long enough for that instant's geometry to have changed was a window it
    /// could not describe. The bound is now an integration of the departure against the
    /// same solver and the same force model the published arc runs on, so the geometry
    /// it describes is the geometry at every instant in the window. Measured on the
    /// rig, that is worth between one and eleven times the arc the ceiling allowed, on
    /// the same craft in the same save.</para>
    ///
    /// <para><b>Measured, not derived.</b> Fixed against a live save on the rig on
    /// 2026-09-05: the mod's own published arc for the active craft was reproduced to
    /// half a metre over 655 s from the game's own elements, the departure of the conic
    /// from the path was then measured for every orbiting vessel at eight phases each,
    /// and again over 928 synthetic orbits on the same real body geometry reaching the
    /// eccentricities, inclinations and radii the save does not contain. Against a
    /// separate absolute integrator sharing none of its equations, the law's worst
    /// overshoot over those 928 is <b>1.0003</b>.</para>
    ///
    /// <para><b>Both earlier sets of constants came from instrument error, in opposite
    /// directions.</b> The first measured the two-body extrapolation against the mod's
    /// own published arc, which is velocity Verlet at 300 steps per revolution: run
    /// with no perturbers at all that integrator walks 106 m from the conic it started
    /// on in 700 s, so the departures it reported were mostly its own truncation and
    /// every crossing it named was between 1.5 and 8 times too early. The second fixed
    /// that and left a quarter-cycle ceiling sitting on a law measured good well past
    /// it. Neither was visible to a check that compared the instrument against the
    /// artefact it was measuring; both were caught by asking an instrument for a number
    /// that was known independently.</para>
    /// </summary>
    public static class PrincipiaHorizonBound
    {
        /// <summary>
        /// How far the published conic may be from the path it is tangent to before
        /// this Uplink stops vouching for it, metres.
        ///
        /// <para>A hundred metres is a judgement about what a client can be shown
        /// without being misled, and it is the one thing here that is not derived from
        /// anything: it is the width of the curve on any diagram anybody will draw from
        /// these elements. Naming the tolerance rather than a fraction of a cycle is
        /// what lets every craft scale away from it.</para>
        /// </summary>
        public const double ToleranceMetres = 100.0;

        /// <summary>
        /// The margin the published span carries under the instant the departure
        /// reaches <see cref="ToleranceMetres"/>.
        ///
        /// <para>The law no longer bounds the crossing, it lands on it: over 1008
        /// measured samples its worst overshoot is a part in three thousand. So this
        /// factor no longer covers the law's own error, and what it does cover is
        /// stated plainly, because a margin nobody can name the purpose of gets tuned
        /// away. It covers the force model: the neighbourhood summed is the primary's
        /// own rather than the whole system, the bodies move on conics taken at the
        /// sample rather than under the producer's own integration, and the strongest
        /// perturber's differential term measured here sits 4.7% away from what the
        /// mod's published arc reports for the same craft. A half is the room a model
        /// with those three gaps should be given.</para>
        /// </summary>
        public const double SafetyFactor = 1.5;

        /// <summary>
        /// How many of the craft's own revolutions the departure is followed for.
        ///
        /// <para><b>A search window, not a ceiling, and the difference matters.</b> A
        /// ceiling says the answer past it would be wrong; this says the answer past it
        /// was not looked for. When the departure never reaches the tolerance inside
        /// it, what gets published is the window over the safety factor, and that is a
        /// claim the measurement has to support rather than a fallback: on every sample
        /// where the law found no crossing inside the window, the rig's own crossing
        /// was past the window too.</para>
        ///
        /// <para>Four, because it is what the law was measured over and what it costs.
        /// Past four revolutions the perturbers are being carried on conics taken from
        /// a sample hours old, which is the assumption here with the shortest life left
        /// in it.</para>
        /// </summary>
        public const double SearchCycles = 4.0;

        /// <summary>
        /// Steps per revolution of the craft: the coarser of the two bounds on the
        /// integration step.
        ///
        /// <para>The tide has two frequencies, the orbital rate and twice it, so a
        /// classical fourth-order step at a sixty-fourth of a revolution resolves it
        /// with room to spare. Measured against an absolute integrator run seventy-five
        /// times finer, the crossing moves by less than a part in three thousand;
        /// halving the step again buys three more digits on a number whose accuracy is
        /// set by the force model.</para>
        /// </summary>
        public const int StepsPerRevolution = 64;

        /// <summary>
        /// What the direction-blind fallback divides its kinematic span by, for a craft
        /// with no repeat to search over.
        ///
        /// <para>Five rather than the four this file used to carry: measured, four
        /// overstates a Kerbin craft at seven tenths eccentricity whose apoapsis reaches
        /// past the Mun by 1.16, so the old constant was not safe out here.</para>
        /// </summary>
        public const double FarFieldAmplification = 5.0;

        /// <summary>Bisection steps once a crossing has been bracketed inside one step.</summary>
        public const int RefineSteps = 24;

        /// <summary>
        /// One perturber's differential (tidal) acceleration across the craft's orbit,
        /// in metres per second squared, at its worst orientation. Zero for a body
        /// whose distance or mass is not a usable number, which drops the term rather
        /// than poisoning the sum.
        ///
        /// <para>Nothing in the integration uses this. It is the scale the no-repeat
        /// fallback divides the tolerance by, and the number a caller can print to say
        /// how hard a craft is being pulled.</para>
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
        /// <c>(origin + offset)/|origin + offset|^3 - origin/|origin|^3</c>, without
        /// ever forming the two terms and subtracting them.
        ///
        /// <para>The two halves agree to a part in ten thousand for a hundred-metre
        /// offset on a thousand-kilometre orbit, so the plain subtraction throws away
        /// four of the sixteen digits before the integrator sees the result. Battin's
        /// form factors the cancellation out algebraically: with
        /// <c>s = (1+q)^(3/2)</c>, <c>s^2 - 1</c> is exactly <c>q(3 + 3q + q^2)</c>, so
        /// <c>(s-1)/s</c> is computable from small quantities alone. It is also what
        /// makes an empty force model report zero to the last bit rather than a
        /// residue.</para>
        /// </summary>
        public static Sitrep.Contract.Vector3d InverseCubeDifference(
            Sitrep.Contract.Vector3d origin, Sitrep.Contract.Vector3d offset)
        {
            var b2 = Sitrep.Contract.Vector3d.Dot(origin, origin);
            if (!(b2 > 0.0) || double.IsInfinity(b2))
            {
                return new Sitrep.Contract.Vector3d(0, 0, 0);
            }
            var q = (offset.X * (2.0 * origin.X + offset.X)
                     + offset.Y * (2.0 * origin.Y + offset.Y)
                     + offset.Z * (2.0 * origin.Z + offset.Z)) / b2;
            if (!(1.0 + q > 0.0))
            {
                // The offset has reached the centre it is measured from. Nothing
                // finite lives there, and a craft that far off is past any tolerance.
                return new Sitrep.Contract.Vector3d(double.NaN, double.NaN, double.NaN);
            }
            var s = Math.Pow(1.0 + q, 1.5);
            var f = q * (3.0 + 3.0 * q + q * q) / (s * (s + 1.0));
            var inverse = 1.0 / (b2 * Math.Sqrt(b2));
            return new Sitrep.Contract.Vector3d(
                inverse * (offset.X - (origin.X + offset.X) * f),
                inverse * (offset.Y - (origin.Y + offset.Y) * f),
                inverse * (offset.Z - (origin.Z + offset.Z) * f));
        }

        /// <summary>
        /// How many seconds past the sample instant these elements are still worth
        /// <see cref="ToleranceMetres"/>, or <c>null</c> when nothing can be said.
        ///
        /// <para>Null is the refusing answer, and it is what a craft with no cycle and
        /// no measurable perturber gets: the first leaves no scale to search over, the
        /// second leaves no rate to divide the tolerance by, and together they leave
        /// nothing to compute. Inventing a span there is the failure this whole seam
        /// exists to prevent.</para>
        ///
        /// <para><b>A craft with no repeat takes the direction-blind arm.</b> The
        /// integration needs a window and a step, and both are fractions of a
        /// revolution; a craft on an escape has neither, and nothing here is entitled
        /// to pick an interval to hunt over on its behalf. That arm is the double
        /// integral of the worst-case tidal magnitude over a flat divisor, which is
        /// what the whole of this file used to be.</para>
        /// </summary>
        public static double? SpanSeconds(
            ConicDeparture? departure, double? characteristicCycleSeconds)
        {
            var cycle = characteristicCycleSeconds;
            var haveCycle = cycle != null && cycle.Value > 0.0
                            && !double.IsNaN(cycle.Value) && !double.IsInfinity(cycle.Value);

            if (departure == null || !departure.HasCraft)
            {
                // The solver could not put the craft anywhere, so there is no conic to
                // measure a departure from and nothing to say about one.
                return null;
            }

            if (!departure.Any)
            {
                // Nothing measurable is pulling on it, so the elements are as good as
                // two-body ones for as far as we looked, and how far we looked is what
                // gets said.
                return haveCycle ? cycle!.Value * SearchCycles / SafetyFactor : (double?)null;
            }

            if (!haveCycle)
            {
                return FarFieldSpan(departure.WorstCaseAcceleration);
            }

            var window = cycle!.Value * SearchCycles;
            var crossing = departure.FirstCrossingSeconds(
                window, ToleranceMetres, (int)(SearchCycles * StepsPerRevolution));
            var span = (crossing ?? window) / SafetyFactor;
            return span > 0.0 ? span : (double?)null;
        }

        /// <summary>
        /// The direction-blind span: the double integral of the worst-case tidal
        /// magnitude, divided by <see cref="FarFieldAmplification"/>. Public because it
        /// is the whole answer for a craft with no repeat, and because a test that
        /// cannot reach it cannot show what it costs.
        /// </summary>
        public static double? FarFieldSpan(double perturbingAcceleration)
        {
            if (!(perturbingAcceleration > 0.0) || double.IsInfinity(perturbingAcceleration))
            {
                return null;
            }
            var span = Math.Sqrt(2.0 * ToleranceMetres / perturbingAcceleration)
                / FarFieldAmplification;
            return double.IsNaN(span) || double.IsInfinity(span) ? (double?)null : span;
        }
    }
}
