using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Propagation
{
    /// <summary>
    /// One perturbing body as the integrator needs it: how heavy it is, and how to
    /// find it at an instant.
    ///
    /// <para><b>Its future positions come from a conic.</b> The mod whose physics we
    /// are matching evaluates every body from its own integrated ephemeris, fitted
    /// to a millimetre, and offers no export taking a future time that we may
    /// honestly call. So each perturber is Kepler-propagated forward from the state
    /// the game is holding right now, which IS that mod's integrated state, and the
    /// approximation is in the propagation forward rather than in the starting
    /// point. See <see cref="TrajectoryForceModel.BodyEphemeris"/> for what that
    /// costs and where it stops being acceptable.</para>
    /// </summary>
    public readonly struct PerturbingBody
    {
        public PerturbingBody(string name, int bodyIndex)
        {
            Name = name;
            BodyIndex = bodyIndex;
        }

        /// <summary>
        /// The body's name as the gravity model spells it, which is how its GM is
        /// looked up. A body the model does not name degrades the curve rather than
        /// stopping it: the term is dropped and the published arc says which went.
        /// </summary>
        public string Name { get; }

        /// <summary>
        /// Index into the propagation provider's body table, which is how its
        /// POSITION is found. The provider is asked rather than a conic being solved
        /// here, because where a body is at an instant is the propagation seam's
        /// question and a second solver beside it is free to disagree with it.
        /// </summary>
        public int BodyIndex { get; }
    }

    /// <summary>What to integrate, and how far.</summary>
    public readonly struct NBodyRequest
    {
        public NBodyRequest(
            StateVector initialState,
            double fromUt,
            double toUt,
            double primaryGravitationalParameter,
            IReadOnlyList<PerturbingBody> perturbers,
            int maxPoints,
            int maxSteps,
            double stepSeconds)
        {
            InitialState = initialState;
            FromUt = fromUt;
            ToUt = toUt;
            PrimaryGravitationalParameter = primaryGravitationalParameter;
            Perturbers = perturbers;
            MaxPoints = maxPoints;
            MaxSteps = maxSteps;
            StepSeconds = stepSeconds;
        }

        /// <summary>Where the craft is at <see cref="FromUt"/>, relative to the primary, in the primary-centred inertial frame.</summary>
        public StateVector InitialState { get; }

        public double FromUt { get; }

        public double ToUt { get; }

        public double PrimaryGravitationalParameter { get; }

        public IReadOnlyList<PerturbingBody> Perturbers { get; }

        /// <summary>How many points to publish. The integration takes many more; see <see cref="TrajectoryArc.SourcePointCount"/>.</summary>
        public int MaxPoints { get; }

        /// <summary>
        /// The hard step budget. Exhausting it is
        /// <see cref="TrajectoryRefusal.BeyondBudget"/> and NEVER a partial curve:
        /// a curve that stops early because we ran out of steps looks exactly like
        /// one that stops because the craft got there, and the two mean opposite
        /// things.
        /// </summary>
        public int MaxSteps { get; }

        /// <summary>
        /// The fixed step. A caller normally derives it from the orbit's own period
        /// rather than picking a constant, which makes the cost roughly flat in
        /// REVOLUTIONS instead of in seconds: see <see cref="StepFor"/>.
        /// </summary>
        public double StepSeconds { get; }
    }

    /// <summary>
    /// The n-body integration: our arithmetic, against a force model somebody else
    /// configured.
    ///
    /// <para>KSP-free and deterministic, so the whole of it is exercised with no
    /// game running. Nothing here reads a clock, a random source, or a static.</para>
    ///
    /// <para><b>Point masses throughout, and that is a statement.</b> The gravity
    /// model carries reference radii and zonal harmonics for some bodies and they
    /// are deliberately not summed: the geopotential is worth about 4e-8 of the
    /// quantity third bodies move by 1e-3, so it costs a per-step branch and buys
    /// nothing a curve can show. A published arc states the geopotential degree it
    /// used and states zero.</para>
    ///
    /// <para><b>No drag and no thrust</b>, matching the model we are imitating,
    /// which integrates with no intrinsic accelerations either. Every arc says so,
    /// because a reentry countdown computed in a vacuum is a vacuum countdown and a
    /// reader who does not know that will read it as a reentry one.</para>
    /// </summary>
    public static class NBodyTrajectory
    {
        /// <summary>The name published on every arc this produces.</summary>
        public const string IntegratorName = "velocity-verlet-fixed-step";

        /// <summary>
        /// Steps per revolution, and the reason the step is period-relative at all.
        ///
        /// <para>A fixed ten seconds is the placeholder the mod we are matching
        /// acknowledges as one, and it is most wasteful exactly where it matters
        /// least: the same step that resolves a low orbit is 28 times finer than a
        /// synchronous one needs. Three hundred keeps a revolution smooth at either
        /// altitude for the same step count.</para>
        /// </summary>
        public const int StepsPerRevolution = 300;

        /// <summary>
        /// A step for an orbit of this period, floored so a degenerate period
        /// cannot produce a step of zero and spin the loop against its budget.
        /// </summary>
        public static double StepFor(double periodSeconds)
        {
            if (double.IsNaN(periodSeconds) || double.IsInfinity(periodSeconds) || periodSeconds <= 0.0)
            {
                return 1.0;
            }
            return Math.Max(periodSeconds / StepsPerRevolution, 1e-3);
        }

        /// <summary>
        /// Integrate, and hand back either a path or the reason there is none.
        ///
        /// <para>The refusals are the point of the return type. A request with no
        /// force model behind it is <see cref="TrajectoryRefusal.NoForceModel"/>,
        /// which no operator can act on; one that ran out of steps is
        /// <see cref="TrajectoryRefusal.BeyondBudget"/>, which shortening the window
        /// fixes. Both used to have to be told as "past horizon", which is a third
        /// thing entirely.</para>
        /// </summary>
        /// <param name="bodyPositions">
        /// Where each perturber is, asked of the elected propagation provider in a
        /// frame centred on the primary. Reaching for it rather than solving a conic
        /// here is the same rule that keeps the transfer search off its own copy of
        /// Lambert: the two-body solver is a TOOL, and a second one beside the seam
        /// is a second opinion nothing reconciles.
        /// </param>
        public static TrajectoryArcAnswer Integrate(
            NBodyRequest request,
            GravityModel? gravityModel,
            int centreBodyIndex,
            IPropagationProvider bodyPositions)
        {
            if (bodyPositions == null) throw new ArgumentNullException(nameof(bodyPositions));
            if (gravityModel == null || gravityModel.Bodies.Count == 0)
            {
                return TrajectoryArcAnswer.Refused(TrajectoryRefusal.NoForceModel);
            }

            var mu = request.PrimaryGravitationalParameter;
            if (!(mu > 0.0) || double.IsInfinity(mu))
            {
                return TrajectoryArcAnswer.Refused(TrajectoryRefusal.NoForceModel);
            }

            var span = request.ToUt - request.FromUt;
            var step = request.StepSeconds;
            if (!(span > 0.0) || !(step > 0.0) ||
                double.IsNaN(span) || double.IsInfinity(span) ||
                double.IsNaN(step) || double.IsInfinity(step))
            {
                return TrajectoryArcAnswer.Refused(TrajectoryRefusal.BeyondBudget);
            }

            var needed = (long)Math.Ceiling(span / step);
            if (request.MaxSteps <= 0 || needed > request.MaxSteps)
            {
                // Refused BEFORE integrating rather than after: a loop that stops
                // where the budget ran out and publishes what it has is publishing
                // a curve that ends for a reason nothing on it can express.
                return TrajectoryArcAnswer.Refused(TrajectoryRefusal.BeyondBudget);
            }

            var frame = PropagationFrame.CentredOn(centreBodyIndex);
            var perturbers = request.Perturbers ?? new List<PerturbingBody>();
            var summed = 0;
            string? missingTerm = null;
            var resolved = new List<ResolvedPerturber>(perturbers.Count);
            foreach (var body in perturbers)
            {
                var entry = gravityModel.Find(body.Name);
                var target = PropagationTarget.Body(body.BodyIndex);
                var reachable = entry != null
                    && bodyPositions.CanPropagate(target, frame, request.FromUt, request.ToUt);
                if (!reachable)
                {
                    // Named once, by the first body that could not be matched. A
                    // list of every one would be a diagnostic; the arc needs to say
                    // that the model is incomplete and which term went, and the
                    // first is the one that made it incomplete.
                    missingTerm ??= entry == null
                        ? body.Name + " is not in the gravity model"
                        : body.Name + " cannot be placed in the primary's frame";
                    continue;
                }
                resolved.Add(new ResolvedPerturber(target, entry!.GravitationalParameter));
                summed++;
            }

            var stepCount = (int)needed;
            var samples = new List<TrajectoryPoint>(stepCount + 1);
            var position = request.InitialState.Position;
            var velocity = request.InitialState.Velocity;
            var ut = request.FromUt;
            var dominance = 0.0;

            var acceleration = AccelerationAt(position, ut, mu, resolved, bodyPositions, frame, ref dominance);
            samples.Add(PointAt(ut, position));

            for (var i = 0; i < stepCount; i++)
            {
                // The last step lands exactly on the requested instant rather than
                // overshooting it, so the far end of the curve is the instant the
                // horizon named and not the first grid point past it.
                var h = Math.Min(step, request.ToUt - ut);
                if (!(h > 0.0)) break;

                // Velocity Verlet: position from the current acceleration, then the
                // acceleration at the new position, then velocity from the mean of
                // the two. Second order and symplectic-ish for the effort, where
                // plain Euler visibly spirals a circular orbit within one lap at
                // this step size.
                position = position + velocity * h + acceleration * (0.5 * h * h);
                ut += h;
                var nextAcceleration = AccelerationAt(position, ut, mu, resolved, bodyPositions, frame, ref dominance);
                velocity = velocity + (acceleration + nextAcceleration) * (0.5 * h);
                acceleration = nextAcceleration;

                if (!IsFinite(position) || !IsFinite(velocity))
                {
                    // A state that has left the reals is not a shorter curve, it is
                    // no curve. Budget is the honest reason: the integration did not
                    // reach the instant asked for.
                    return TrajectoryArcAnswer.Refused(TrajectoryRefusal.BeyondBudget);
                }
                samples.Add(PointAt(ut, position));
            }

            if (samples.Count < 2)
            {
                return TrajectoryArcAnswer.Refused(TrajectoryRefusal.BeyondBudget);
            }

            var published = Decimate(samples, request.MaxPoints);
            var arc = new TrajectoryArc
            {
                Frame = new TrajectoryFrameRef
                {
                    Kind = TrajectoryFrameKind.BodyCentredInertial,
                    CentreBodyIndex = centreBodyIndex >= 0 ? centreBodyIndex : (int?)null,
                    LengthsPulsate = false,
                },
                Points = published,
                FromUt = samples[0].Ut,
                ToUt = samples[samples.Count - 1].Ut,
                SourcePointCount = samples.Count,
                Derivation = missingTerm == null
                    ? TrajectoryDerivation.OwnNBody
                    : TrajectoryDerivation.OwnNBodyDegraded,
                ForceModel = new TrajectoryForceModel
                {
                    GravityModelFound = true,
                    PerturbingBodyCount = summed,
                    GeopotentialDegree = 0,
                    BodyEphemeris = "kepler-from-snapshot",
                    ThirdBodyDominance = dominance,
                    MissingTerm = missingTerm,
                    Integrator = IntegratorName,
                    StepSeconds = step,
                    StepCount = stepCount,
                    Vacuum = true,
                },
            };
            return TrajectoryArcAnswer.Drawn(arc);
        }

        /// <summary>
        /// The acceleration on the craft at <paramref name="position"/>: the
        /// primary's, plus each perturber's differential term.
        ///
        /// <para>The perturber term is the DIFFERENCE between its pull on the craft
        /// and its pull on the primary, because the frame is centred on the primary
        /// and is therefore accelerating. Dropping the second half is the classic
        /// error: it leaves a term that does not vanish as the perturber recedes,
        /// so a distant heavy body appears to drag the whole orbit sideways.</para>
        /// </summary>
        private static Vector3d AccelerationAt(
            Vector3d position,
            double ut,
            double mu,
            IReadOnlyList<ResolvedPerturber> perturbers,
            IPropagationProvider bodyPositions,
            PropagationFrame frame,
            ref double dominance)
        {
            var r = position.Magnitude();
            if (!(r > 0.0)) return new Vector3d(0, 0, 0);
            var central = position * (-mu / (r * r * r));
            var centralMagnitude = mu / (r * r);

            var total = central;
            for (var i = 0; i < perturbers.Count; i++)
            {
                var body = perturbers[i];
                var bodyPosition = bodyPositions.Solve(body.Target, frame, ut).Position;

                var toBody = bodyPosition - position;
                var d = toBody.Magnitude();
                var b = bodyPosition.Magnitude();
                if (!(d > 0.0) || !(b > 0.0)) continue;

                var pull = toBody * (body.Mu / (d * d * d));
                var onPrimary = bodyPosition * (body.Mu / (b * b * b));
                var term = pull - onPrimary;
                total = total + term;

                if (centralMagnitude > 0.0)
                {
                    var ratio = term.Magnitude() / centralMagnitude;
                    if (ratio > dominance) dominance = ratio;
                }
            }
            return total;
        }

        /// <summary>A perturber that survived the match: where to ask for it, and how heavy the model says it is.</summary>
        private readonly struct ResolvedPerturber
        {
            public ResolvedPerturber(PropagationTarget target, double mu)
            {
                Target = target;
                Mu = mu;
            }

            public PropagationTarget Target { get; }

            public double Mu { get; }
        }

        private static TrajectoryPoint PointAt(double ut, Vector3d p) =>
            new TrajectoryPoint { Ut = ut, X = p.X, Y = p.Y, Z = p.Z };

        private static bool IsFinite(Vector3d v) =>
            !double.IsNaN(v.X) && !double.IsInfinity(v.X) &&
            !double.IsNaN(v.Y) && !double.IsInfinity(v.Y) &&
            !double.IsNaN(v.Z) && !double.IsInfinity(v.Z);

        /// <summary>
        /// Thin the integrated samples down to what is published, keeping the first
        /// and the last exactly.
        ///
        /// <para>The far end has to survive verbatim because a horizon mark is drawn
        /// on it, and a mark drawn a step short of where authority ends is a mark
        /// telling a small lie in the one place the whole mechanism exists to tell
        /// the truth.</para>
        ///
        /// <para>Uniform in index, which is uniform in TIME because the step is
        /// fixed. Curvature-weighted thinning would keep more resolution where the
        /// curve is interesting and it is not what this does; a reader is told the
        /// pre-decimation count either way, and may not treat a published point as
        /// an event instant under either rule.</para>
        /// </summary>
        private static List<TrajectoryPoint> Decimate(List<TrajectoryPoint> samples, int maxPoints)
        {
            if (maxPoints < 2 || samples.Count <= maxPoints)
            {
                return samples;
            }
            var kept = new List<TrajectoryPoint>(maxPoints);
            var last = samples.Count - 1;
            for (var i = 0; i < maxPoints - 1; i++)
            {
                var index = (int)((long)i * last / (maxPoints - 1));
                kept.Add(samples[index]);
            }
            kept.Add(samples[last]);
            return kept;
        }
    }
}
