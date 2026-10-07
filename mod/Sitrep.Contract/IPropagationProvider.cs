using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The capability id every <see cref="IPropagationProvider"/> competes for.
    ///
    /// <para>A provider registered under any other id is never resolved, and the
    /// only symptom is a trajectory that stays closed-form.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public static class PropagationCapability
    {
        /// <summary>The capability id, <c>"propagation"</c>: register an <see cref="IPropagationProvider"/> under exactly this string.</summary>
        public const string Id = "propagation";
    }

    /// <summary> Says where something will be: the one source of trajectories for
    /// this install, elected under <see cref="PropagationCapability.Id"/>. Orbital
    /// elements travel over the wire, and each consumer derives positions from
    /// them on demand rather than receiving position samples every tick.
    ///
    /// <para>Every member takes a <see cref="PropagationTarget"/>, which names the
    /// object, and where it matters a <see cref="PropagationFrame"/> and a UT. A
    /// provider backed by different physics resolves the target against its own
    /// model and need not reason in conics. The default provider is a two-body
    /// analytic solver, and an n-body install registers its own.
    /// <internal>Gonogo resolves this interface and never asks which is
    /// installed.</internal></para>
    ///
    /// <para>Replacing the provider replaces every member: the period, the radius
    /// extremes, the batch solve and the closest approach, as well as
    /// <see cref="Solve"/>. So an integrated trajectory and a two-body encounter
    /// for the same craft are never published side by side.</para>
    ///
    /// <para>Every result must be deterministic (same inputs, same outputs, no
    /// wall clock and no randomness), because callers cache results, compare two
    /// of them and draw the difference. Refuse what you do not support through
    /// <see cref="CanPropagate(PropagationTarget, PropagationFrame, double,
    /// double)"/> rather than approximating it: a two-body result for an n-body
    /// question looks exactly like a right one on screen.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    /// <categoryDescription>
    /// How Gonogo predicts where a body or craft is between observations, and the
    /// models an Uplink can supply to it: the propagation provider and its
    /// horizons, the bases a reckoning may rest on, and the degrade, occlusion and
    /// reach models a comms link is graded by.
    /// </categoryDescription>
    public interface IPropagationProvider : ISitrepProvider
    {
        /// <summary>
        /// Solve for the state vector of <paramref name="target"/> at
        /// <paramref name="ut"/> (UT seconds), expressed in
        /// <paramref name="frame"/>. Must be deterministic: same inputs, same
        /// outputs, no wall-clock or random dependence.
        ///
        /// <para>Throws <see cref="NotSupportedException"/> when <see
        /// cref="CanPropagate(PropagationTarget, PropagationFrame, double,
        /// double)"/> would refuse. Callers on a hot path should ask first
        /// rather than catch.</para>
        /// </summary>
        /// <param name="target">The object to locate.</param>
        /// <param name="frame">The frame the result is expressed in.</param>
        /// <param name="ut">The instant, in UT seconds.</param>
        /// <returns>Position (metres) and velocity (metres per second) in <paramref name="frame"/>.</returns>
        StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut);

        /// <summary>
        /// The same question at many UTs, written into <paramref name="into"/>.
        ///
        /// <para>Gonogo asks for on the order of 1440 instants at a time when it
        /// predicts comms contacts. For an analytic solver this can be a loop; a
        /// provider that integrates should solve it in one pass.</para>
        /// </summary>
        /// <param name="target">The object to locate.</param>
        /// <param name="frame">The frame every result is expressed in.</param>
        /// <param name="uts">The instants, in UT seconds.</param>
        /// <param name="into">Receives one state vector per entry of <paramref name="uts"/>, at the same index.</param>
        void SolveMany(
            PropagationTarget target,
            PropagationFrame frame,
            IReadOnlyList<double> uts,
            StateVector[] into);

        /// <summary>
        /// The characteristic timescale of the target's own motion, seconds, or
        /// null when its motion has no repeat.
        ///
        /// <para>For a two-body ellipse this is the orbital period. Null is a
        /// real result and not a failure: a hyperbolic trajectory has no
        /// period, and neither does a general non-Keplerian one. A caller needs
        /// a no-period branch.</para>
        /// </summary>
        double? CharacteristicCycleSeconds(PropagationTarget target);

        /// <summary>
        /// How close in and how far out the target gets from the body it orbits,
        /// metres, or null when its motion has no such bound.
        ///
        /// <para>For a two-body ellipse these are the periapsis and apoapsis radii,
        /// <c>sma * (1 -/+ ecc)</c>. Under other physics they are still the
        /// closest and furthest distances, but not at fixed apsides.</para>
        ///
        /// <para>Null is a real result, on the same terms as <see
        /// cref="CharacteristicCycleSeconds"/>: a hyperbolic trajectory recedes
        /// forever and has no furthest point.</para>
        /// </summary>
        RadiusExtremes? RadiusExtremesOf(PropagationTarget target);

        /// <summary> Whether this provider can return a reliable result for <paramref
        /// name="target"/> in <paramref name="frame"/> across the window
        /// [<paramref name="fromUt"/>, <paramref name="toUt"/>].
        ///
        /// <para>Return false for either of two reasons. The target may be one this
        /// provider cannot describe at all: KSP gives the Sun <c>ecc = 1</c> and
        /// <c>sma = 0</c>, so every walk up the body hierarchy reaches it. Or the
        /// frame may be unreachable, or the window may run past a horizon beyond
        /// which the result is no longer reliable. An analytic two-body solver has
        /// no such horizon; anything that integrates does.</para>
        ///
        /// <para>Callers ask this, and nothing else of their own, before using a
        /// frame centred on another body.</para>
        /// </summary>
        bool CanPropagate(PropagationTarget target, PropagationFrame frame, double fromUt, double toUt);

        /// <summary>
        /// The next closest approach between <paramref name="subject"/> and
        /// <paramref name="other"/>: the first instant at or after
        /// <paramref name="fromUt"/> at which their separation stops shrinking
        /// and starts growing, and how far apart they are then. Null when there
        /// is no such instant before <paramref name="toUt"/>, and null when this
        /// provider refuses either target or the frame. Never a zero-distance
        /// record standing in for no result.
        ///
        /// <para>The first such instant, not the smallest separation in the
        /// window: an operator flying a rendezvous wants what happens next, and a
        /// deeper approach three orbits later is a different question.</para>
        ///
        /// <para>Compute it from the provider's own trajectories for both named
        /// targets, not from KSP's two-body helper. Swapping
        /// <paramref name="subject"/> and <paramref name="other"/> must not change
        /// the result; the names only say which craft is being reported on.</para>
        ///
        /// <para>Never return an encounter after <paramref name="toUt"/>, for the
        /// same reason <see cref="CanPropagate(PropagationTarget,
        /// PropagationFrame, double, double)"/> takes a window. A caller wanting
        /// the next approach picks the window from
        /// <see cref="CharacteristicCycleSeconds"/> of both objects: several cycles
        /// of the faster one, since an approach is rarely on the first pass, and
        /// short enough that the provider can still resolve that faster
        /// motion.</para>
        ///
        /// <para>Deterministic, as <see cref="Solve"/> is. A provider that searches
        /// numerically derives its sampling from the arguments, never from
        /// anything else.</para>
        /// </summary>
        /// <param name="subject">The craft being reported on.</param>
        /// <param name="other">What it is approaching.</param>
        /// <param name="frame">The frame the approach is computed in.</param>
        /// <param name="fromUt">Start of the search window, in UT seconds.</param>
        /// <param name="toUt">End of the search window, in UT seconds.</param>
        /// <returns>The next approach in the window, or null.</returns>
        ClosestApproach? SolveClosestApproach(
            PropagationTarget subject,
            PropagationTarget other,
            PropagationFrame frame,
            double fromUt,
            double toUt);
    }

    /// <summary>
    /// Whether a caller accepts a result past the span the provider vouches
    /// for. It chooses certification, not which model runs: both values get the
    /// same model from the same provider.
    ///
    /// <para><see cref="Unspecified"/> is zero and means nothing was chosen, so
    /// a default value never grants the permissive setting.</para>
    /// <internal>
    /// Under an integrating provider the result is the craft's conic either
    /// way, because there is no integrated point query to select. What differs
    /// is whether the caller reads it past the point the provider stands behind,
    /// which IPropagationProvider.CanPropagate already decides. The zero rule
    /// matches TrajectoryKind's.
    /// </internal>
    /// </summary>
    /// <category>Orbits and trajectories</category>
    public enum PropagationCertification
    {
        /// <summary>Nothing was chosen. A request carrying this is refused
        /// rather than given a default.</summary>
        Unspecified = 0,

        /// <summary>
        /// Return a result wherever the solver can reach, past any horizon. For a
        /// planning search, such as a transfer grid, which asks a two-body
        /// question about future instants on purpose.
        /// <internal>
        /// A horizon derived from how long osculating elements stand in for an
        /// integrated path says nothing about a two-body question.
        /// </internal>
        /// </summary>
        Unbounded = 1,

        /// <summary>
        /// Return results only across spans the provider vouches for, and decline
        /// past them. For an operational prediction, such as when a link will be
        /// reacquired, where a time read off an unvouched arc would look certain
        /// without being so.
        /// </summary>
        CertifiedOnly = 2,
    }

    /// <summary>Frame-free overloads for callers working in the target's own
    /// parent frame.</summary>
    /// <category>Propagation and models</category>
    public static class PropagationProviderExtensions
    {
        /// <summary>
        /// <see cref="IPropagationProvider.CanPropagate"/> in the target's own
        /// parent frame, the frame most callers want.
        /// </summary>
        public static bool CanPropagate(
            this IPropagationProvider provider,
            PropagationTarget target,
            double fromUt,
            double toUt)
        {
            if (provider == null) throw new ArgumentNullException(nameof(provider));
            return provider.CanPropagate(
                target, PropagationFrame.CentredOn(target.ParentBodyIndex), fromUt, toUt);
        }

        /// <summary><see cref="IPropagationProvider.Solve"/> in the target's
        /// own parent frame.</summary>
        public static StateVector Solve(
            this IPropagationProvider provider,
            PropagationTarget target,
            double ut)
        {
            if (provider == null) throw new ArgumentNullException(nameof(provider));
            return provider.Solve(target, PropagationFrame.CentredOn(target.ParentBodyIndex), ut);
        }
    }
}
