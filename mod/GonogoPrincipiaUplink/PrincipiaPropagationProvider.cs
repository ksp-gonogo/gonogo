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

        /// <param name="conics">
        /// The solver this provider displaced, reached through
        /// <see cref="ProviderContext.Vanilla{T}"/>. Not optional and not
        /// defaulted: a provider that quietly answered zero when it had no solver
        /// would put a craft at the centre of its primary on every sample, and the
        /// silence predictor would believe it.
        /// </param>
        public PrincipiaPropagationProvider(IPropagationProvider conics)
        {
            _conics = conics ?? throw new ArgumentNullException(nameof(conics));
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

        public bool CanPropagate(
            PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) =>
            _conics.CanPropagate(target, frame, fromUt, toUt);

        public ClosestApproach? SolveClosestApproach(
            PropagationTarget subject,
            PropagationTarget other,
            PropagationFrame frame,
            double fromUt,
            double toUt) =>
            _conics.SolveClosestApproach(subject, other, frame, fromUt, toUt);
    }
}
