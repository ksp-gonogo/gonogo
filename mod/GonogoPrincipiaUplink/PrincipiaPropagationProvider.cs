using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The propagation provider for an install whose physics is n-body: it states
    /// that trajectories here are INTEGRATED, and forwards every closed-form
    /// question to the two-body solver it displaced.
    ///
    /// <para><b>What it adds is one fact, and that fact is the whole point.</b>
    /// Nothing in core is allowed to know which physics mod is installed, so
    /// nothing in core can say whether a craft's published elements are the path it
    /// flies or merely the conic tangent to it at this instant. Under stock physics
    /// they are the path; under n-body physics they are the tangent, and a client
    /// drawing a closed ellipse from them draws a curve the craft will not fly.
    /// This Uplink knows which install it is in, so this is where the fact can be
    /// stated, and <see cref="IIntegratedTrajectorySource"/> is how a provider
    /// states it.</para>
    ///
    /// <para><b>It answers one question of its own, and that question is the
    /// horizon.</b> <see cref="CanPropagate"/> takes a WINDOW because a provider that
    /// integrates has a limit and the interface is where it states one. Forwarding it
    /// answered "yes, always", which left core applying a fixed fraction of a cycle
    /// to every craft in the save; that fraction was measured five times too long for
    /// the worst craft in a live one. So this member is computed here, from the force
    /// model this Uplink already publishes, and everything else still forwards.
    /// <see cref="PrincipiaHorizonBound"/> holds the arithmetic and the rig
    /// measurements behind its constants.</para>
    ///
    /// <para><b>Why it forwards rather than integrates.</b> The conic answers a
    /// caller asks for through this interface are the osculating state the game is
    /// holding right now, propagated in the frame it was asked about: where a body
    /// is, how long a revolution takes, when two craft next pass closest. Those are
    /// two-body questions with two-body answers, and the producer's own trajectory
    /// exports either write to the save or abort the process on state we do not
    /// control, so there is no honest integrated substitute to forward them to. The
    /// integrated answer, the one this marker promises, is the ARC, and that is
    /// computed against the force model this Uplink publishes separately. Carrying
    /// a second copy of two-body motion in here to answer the rest would be the
    /// duplication the propagation seam exists to prevent, which is why the
    /// displaced solver arrives as a constructor argument.</para>
    ///
    /// <para><b>Registered whether or not a force model could be read.</b> Whether
    /// trajectories are integrated is a property of the INSTALL, and it does not
    /// stop being true because a gravity-model config is missing. Withholding this
    /// registration when the model is absent would publish closed-form elements
    /// with no complaint attached, which is precisely the reading that made a dead
    /// feature look like a working one. Registered, the horizon says integrated,
    /// the arc is attempted, and the missing model reaches a client as
    /// <see cref="TrajectoryRefusal.NoForceModel"/>: an install problem, said
    /// plainly.</para>
    /// </summary>
    public sealed class PrincipiaPropagationProvider : IPropagationProvider, IIntegratedTrajectorySource
    {
        public const string ProviderIdValue = "principia-propagation";

        private readonly IPropagationProvider _conics;
        private readonly Func<GravityModel?> _forceModel;
        private readonly Func<int, IReadOnlyList<PrincipiaPerturber>> _perturbers;

        private readonly object _boundGate = new object();
        private string? _boundVesselId;
        private double _boundFromUt = double.NaN;
        private double _boundSma = double.NaN;
        private double? _boundSpan;
        private bool _hasBound;

        /// <param name="conics">
        /// The solver this provider displaced, reached through
        /// <see cref="ProviderContext.Vanilla{T}"/>. Not optional and not
        /// defaulted: a provider that quietly answered zero when it had no solver
        /// would put a craft at the centre of its primary on every sample, and the
        /// silence predictor would believe it.
        /// </param>
        /// <param name="forceModel">
        /// The masses the bound is computed against, read on demand because the
        /// election runs before the game has a config database. Null from it is a
        /// stated state and not a gap to fill: an install whose gravity model could
        /// not be read has no way to bound a craft, so this provider vouches for
        /// nothing and the horizon says so. Substituting stock's masses there would
        /// answer with a bound that agrees with nothing while looking exactly like
        /// one that does.
        /// </param>
        /// <param name="perturbers">
        /// Which bodies to sum, given the index of the primary the craft orbits.
        /// Injected rather than read here so the whole of the bound is exercised with
        /// no game running.
        /// </param>
        public PrincipiaPropagationProvider(
            IPropagationProvider conics,
            Func<GravityModel?> forceModel,
            Func<int, IReadOnlyList<PrincipiaPerturber>> perturbers)
        {
            _conics = conics ?? throw new ArgumentNullException(nameof(conics));
            _forceModel = forceModel ?? throw new ArgumentNullException(nameof(forceModel));
            _perturbers = perturbers ?? throw new ArgumentNullException(nameof(perturbers));
        }

        public string ProviderId => ProviderIdValue;

        public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
            _conics.Solve(target, frame, ut);

        public void SolveMany(
            PropagationTarget target,
            PropagationFrame frame,
            IReadOnlyList<double> uts,
            StateVector[] into) =>
            _conics.SolveMany(target, frame, uts, into);

        public double? CharacteristicCycleSeconds(PropagationTarget target) =>
            _conics.CharacteristicCycleSeconds(target);

        public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) =>
            _conics.RadiusExtremesOf(target);

        /// <summary>
        /// Whether these elements are worth extrapolating across this window, which
        /// under n-body physics is two questions and not one.
        ///
        /// <para>The first is the displaced solver's and is asked first: a target it
        /// cannot describe, or a frame it cannot reach, is refused for the reasons it
        /// has always been refused for, and those do not change because the physics
        /// did. The second is this Uplink's, and it is the horizon: how long the
        /// osculating conic stays within
        /// <see cref="PrincipiaHorizonBound.ToleranceMetres"/> of the path it is
        /// tangent to, computed from the force model published beside it.</para>
        ///
        /// <para><b>A BODY is passed straight through, and that is not an
        /// oversight.</b> The horizon is a statement about a CRAFT's osculating
        /// elements. A body's are the producer's own ephemeris, fitted to a
        /// millimetre and re-read every sample, and the acceleration walk that
        /// computes a bound asks this very question about each perturber it wants to
        /// place: bounding a body here would refuse the walk that the bound is made
        /// of.</para>
        ///
        /// <para>The instant itself is always answerable when the solver can reach
        /// it, however perturbed the craft is. A zero-length window asks where
        /// something IS, which the osculating elements answer exactly by
        /// construction, and it is what every visibility and encounter caller asks
        /// for.</para>
        /// </summary>
        public bool CanPropagate(
            PropagationTarget target, PropagationFrame frame, double fromUt, double toUt)
        {
            if (!_conics.CanPropagate(target, frame, fromUt, toUt))
            {
                return false;
            }
            if (target.Kind != PropagationTargetKind.Vessel || !(toUt > fromUt))
            {
                return true;
            }

            var span = BoundSeconds(target, fromUt);
            return span != null && toUt - fromUt <= span.Value;
        }

        /// <summary>
        /// How far past <paramref name="fromUt"/> this craft's elements are worth
        /// extrapolating, or null when nothing can be stated.
        ///
        /// <para>Held for the last craft and instant asked about, because recovering
        /// the horizon from this predicate is a bisection and every step of it asks
        /// the same question of the same craft. Without the memo one horizon costs
        /// eighteen walks of the neighbourhood instead of one, and the walk is what
        /// the whole answer costs.</para>
        /// </summary>
        private double? BoundSeconds(PropagationTarget target, double fromUt)
        {
            var elements = target.Osculating;
            if (elements == null)
            {
                return null;
            }

            lock (_boundGate)
            {
                if (_hasBound
                    && string.Equals(_boundVesselId, target.Id, StringComparison.Ordinal)
                    && _boundFromUt.Equals(fromUt)
                    && _boundSma.Equals(elements.Value.Sma))
                {
                    return _boundSpan;
                }
            }

            var span = ComputeBoundSeconds(target, fromUt, elements.Value);

            lock (_boundGate)
            {
                _hasBound = true;
                _boundVesselId = target.Id;
                _boundFromUt = fromUt;
                _boundSma = elements.Value.Sma;
                _boundSpan = span;
            }
            return span;
        }

        private double? ComputeBoundSeconds(
            PropagationTarget target, double fromUt, OrbitElements elements)
        {
            var model = _forceModel();
            if (model == null)
            {
                // No masses, no bound. The same absence reaches the client beside
                // this as TrajectoryRefusal.NoForceModel, so the two halves of the
                // payload say the same thing about the same install problem.
                return null;
            }

            var parentFrame = PropagationFrame.CentredOn(target.ParentBodyIndex);
            if (!_conics.CanPropagate(target, parentFrame, fromUt, fromUt))
            {
                return null;
            }

            var radius = _conics.Solve(target, parentFrame, fromUt).Position.Magnitude();
            var perturbing = 0.0;
            var neighbourhood = _perturbers(target.ParentBodyIndex);
            if (neighbourhood != null)
            {
                for (var i = 0; i < neighbourhood.Count; i++)
                {
                    var body = neighbourhood[i];
                    var entry = model.Find(body.Name);
                    if (entry == null) continue;

                    var bodyTarget = PropagationTarget.Body(body.BodyIndex);
                    if (!_conics.CanPropagate(bodyTarget, parentFrame, fromUt, fromUt)) continue;

                    perturbing += PrincipiaHorizonBound.PerturbingAcceleration(
                        radius,
                        entry.GravitationalParameter,
                        _conics.Solve(bodyTarget, parentFrame, fromUt).Position.Magnitude());
                }
            }

            return PrincipiaHorizonBound.SpanSeconds(
                perturbing, _conics.CharacteristicCycleSeconds(target));
        }

        public ClosestApproach? SolveClosestApproach(
            PropagationTarget subject,
            PropagationTarget other,
            PropagationFrame frame,
            double fromUt,
            double toUt) =>
            _conics.SolveClosestApproach(subject, other, frame, fromUt, toUt);
    }
}
