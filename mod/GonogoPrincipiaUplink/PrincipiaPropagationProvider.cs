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
    // The base list stays on this one line: the seam gate in Sitrep.Core.Tests reads
    // source text and matches a type's bases on the same line as its name, so a
    // legal wrap here reports every seam this type satisfies as implemented by
    // nothing.
    public sealed class PrincipiaPropagationProvider : IPropagationProvider, IIntegratedTrajectorySource, IBodyEphemerisHorizon
    {
        public const string ProviderIdValue = "principia-propagation";

        private readonly IPropagationProvider _conics;
        private readonly Func<GravityModel?> _forceModel;
        private readonly Func<int, IReadOnlyList<PrincipiaPerturber>> _perturbers;
        private readonly Func<int, int?> _parentOf;

        private readonly object _boundGate = new object();
        private string? _boundVesselId;
        private double _boundFromUt = double.NaN;
        private double _boundSma = double.NaN;
        private double? _boundSpan;
        private bool _hasBound;

        private readonly object _bodyGate = new object();
        private readonly Dictionary<int, BodyBound> _bodyBounds = new Dictionary<int, BodyBound>();

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
        /// <param name="parentOf">
        /// Which body a body orbits, or null for the root and for anything the game
        /// will not say. Needed only by the BODY horizon, which has to know the frame
        /// a body's own conic is measured in; a craft carries that on its target and a
        /// body deliberately does not, because which body a body orbits is the
        /// provider's to know rather than the caller's to assert. Injected on the same
        /// terms as <paramref name="perturbers"/>, so the whole of the bound is
        /// exercised with no game running.
        /// </param>
        public PrincipiaPropagationProvider(
            IPropagationProvider conics,
            Func<GravityModel?> forceModel,
            Func<int, IReadOnlyList<PrincipiaPerturber>> perturbers,
            Func<int, int?> parentOf)
        {
            _conics = conics ?? throw new ArgumentNullException(nameof(conics));
            _forceModel = forceModel ?? throw new ArgumentNullException(nameof(forceModel));
            _perturbers = perturbers ?? throw new ArgumentNullException(nameof(perturbers));
            _parentOf = parentOf ?? throw new ArgumentNullException(nameof(parentOf));
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

            // Where everything is at any instant, not where it is at this one. The
            // bound integrates the difference between the published conic and the
            // path, and both halves of that difference move: the craft round its own
            // conic, and every perturber round the primary. Handing the bound a
            // SAMPLER rather than a position is what lets it carry both without this
            // Uplink holding a second copy of two-body motion, which is the
            // duplication the propagation seam exists to prevent.
            var departure = new ConicDeparture(
                elements.Mu,
                fromUt,
                ut => _conics.Solve(target, parentFrame, ut).Position);

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

                    departure.Add(
                        entry.GravitationalParameter,
                        ut => _conics.Solve(bodyTarget, parentFrame, ut).Position);
                }
            }

            return PrincipiaHorizonBound.SpanSeconds(
                departure, _conics.CharacteristicCycleSeconds(target));
        }

        public ClosestApproach? SolveClosestApproach(
            PropagationTarget subject,
            PropagationTarget other,
            PropagationFrame frame,
            double fromUt,
            double toUt) =>
            _conics.SolveClosestApproach(subject, other, frame, fromUt, toUt);

        /// <summary>
        /// How far this body's published elements stay within
        /// <see cref="PrincipiaHorizonBound.ToleranceMetres"/> of the ephemeris they
        /// osculate.
        ///
        /// <para><b>The same law, pointed at a different object.</b> A moon about its
        /// planet is a conic about a primary perturbed by a neighbourhood, which is
        /// the problem <see cref="ConicDeparture"/> already integrates; nothing in it
        /// is about craft. Measured against the rig's own stock geometry, the answers
        /// span three orders of magnitude, from about three minutes for a moon of Jool
        /// to about twenty hours for Kerbin about the star, which is why this is asked
        /// per body and why one number for the catalogue would have been wrong for
        /// almost all of it. See <c>BodyEphemerisHorizonTests</c>.</para>
        ///
        /// <para><b>Held per body and only ever re-measured once it has EXPIRED.</b>
        /// Thirty-four bodies each paying a four-revolution integration per sample is
        /// not affordable on the Courier thread, and no fraction of a sample interval
        /// is a defensible thing to recompute on. What is defensible is this: the
        /// cached answer is an absolute instant, the span handed back is what is LEFT
        /// of it, and a new measurement is taken when nothing is. So the published
        /// horizon never reaches past an instant that was measured from a real sample,
        /// it shrinks between measurements rather than drifting either way, and being
        /// short is the safe direction for a bound to be wrong in.</para>
        ///
        /// <para><b>A cached answer is thrown away when the clock goes BACKWARDS</b>,
        /// which in this game is a revert or a load and neither is rare. The instant a
        /// measurement was taken AT is held beside the one it reaches to, because
        /// without it an answer measured at a later sample would be handed to an
        /// earlier one as a span of everything between them, which is the one way this
        /// cache could over-vouch rather than under-vouch.</para>
        ///
        /// <para>Null wherever nothing can be said, never a number: no force model, a
        /// root body with no primary to depart from, a body the gravity model does not
        /// name, or a body the displaced solver cannot place.</para>
        /// </summary>
        public double? BodySpanSeconds(int bodyIndex, double fromUt)
        {
            if (double.IsNaN(fromUt) || double.IsInfinity(fromUt))
            {
                return null;
            }

            lock (_bodyGate)
            {
                if (_bodyBounds.TryGetValue(bodyIndex, out var held)
                    && fromUt >= held.MeasuredAt && fromUt < held.UntilUt)
                {
                    return held.UntilUt - fromUt;
                }
            }

            var span = ComputeBodySpanSeconds(bodyIndex, fromUt);
            lock (_bodyGate)
            {
                if (span == null) _bodyBounds.Remove(bodyIndex);
                else _bodyBounds[bodyIndex] = new BodyBound(fromUt, fromUt + span.Value);
            }
            return span;
        }

        /// <summary>One body's measurement: when it was taken, and what it reaches to.</summary>
        private readonly struct BodyBound
        {
            public BodyBound(double measuredAt, double untilUt)
            {
                MeasuredAt = measuredAt;
                UntilUt = untilUt;
            }

            public double MeasuredAt { get; }

            public double UntilUt { get; }
        }

        private double? ComputeBodySpanSeconds(int bodyIndex, double fromUt)
        {
            var model = _forceModel();
            if (model == null)
            {
                // No masses, no bound. The same absence reaches the client beside this
                // as TrajectoryRefusal.NoForceModel on the craft side, so the two
                // halves of the install say the same thing about the same problem.
                return null;
            }

            var parentIndex = _parentOf(bodyIndex);
            if (parentIndex == null || parentIndex.Value == bodyIndex)
            {
                // The root. It is the frame everything else is measured in and has no
                // primary to depart from, so there is no departure to integrate.
                return null;
            }

            var target = PropagationTarget.Body(bodyIndex);
            var parentFrame = PropagationFrame.CentredOn(parentIndex.Value);
            if (!_conics.CanPropagate(target, parentFrame, fromUt, fromUt))
            {
                return null;
            }

            // The primary's mass out of the PRODUCER's gravity model rather than the
            // game's, for the reason the craft bound reads it there: how far this
            // Uplink will vouch for something is a statement about its own model, and
            // a bound taken against another mod's masses agrees with nothing while
            // looking exactly like one that does.
            var primaryMu = MuOfBody(model, parentIndex.Value, bodyIndex);
            if (primaryMu == null)
            {
                return null;
            }

            var departure = new ConicDeparture(
                primaryMu.Value,
                fromUt,
                ut => _conics.Solve(target, parentFrame, ut).Position);

            // The PRIMARY's neighbourhood, which is where this body's siblings and its
            // primary's own parent live. The body itself is dropped: a body does not
            // perturb its own conic, and summing it in would put its whole central
            // term into the differential.
            var neighbourhood = _perturbers(parentIndex.Value);
            if (neighbourhood != null)
            {
                for (var i = 0; i < neighbourhood.Count; i++)
                {
                    var body = neighbourhood[i];
                    if (body.BodyIndex == bodyIndex || body.BodyIndex == parentIndex.Value) continue;

                    var entry = model.Find(body.Name);
                    if (entry == null) continue;

                    var perturberTarget = PropagationTarget.Body(body.BodyIndex);
                    if (!_conics.CanPropagate(perturberTarget, parentFrame, fromUt, fromUt)) continue;

                    departure.Add(
                        entry.GravitationalParameter,
                        ut => _conics.Solve(perturberTarget, parentFrame, ut).Position);
                }
            }

            return PrincipiaHorizonBound.SpanSeconds(
                departure, _conics.CharacteristicCycleSeconds(target));
        }

        /// <summary>
        /// One body's gravitational parameter out of the force model, found by the
        /// name the model is keyed on.
        ///
        /// <para>The name comes off the neighbourhood walk, which is the only table
        /// that joins a propagation index to the string the producer's config uses.
        /// A body's own neighbourhood always lists its parent, so the primary is
        /// reachable from the child's walk; <paramref name="childIndex"/> is which
        /// walk to ask.</para>
        /// </summary>
        private double? MuOfBody(GravityModel model, int bodyIndex, int childIndex)
        {
            var neighbourhood = _perturbers(childIndex);
            if (neighbourhood == null) return null;
            for (var i = 0; i < neighbourhood.Count; i++)
            {
                if (neighbourhood[i].BodyIndex != bodyIndex) continue;
                var entry = model.Find(neighbourhood[i].Name);
                if (entry == null) return null;
                var mu = entry.GravitationalParameter;
                return mu > 0.0 && !double.IsInfinity(mu) ? mu : (double?)null;
            }
            return null;
        }
    }
}
