using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The capability id every <see cref="IPropagationProvider"/> competes for.
    ///
    /// <para>Declared here, beside the interface, because a registering Uplink
    /// and the election that resolves it have to agree on this string. A provider
    /// registered under any other id is never resolved, and the only symptom is
    /// a trajectory that stays closed-form.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public static class PropagationCapability
    {
        /// <summary>The capability id, <c>"propagation"</c>: register an <see cref="IPropagationProvider"/> under exactly this string.</summary>
        public const string Id = "propagation";
    }

    /// <summary> Whatever can say where something will be: the one authority on
    /// a trajectory for this install, elected under <see
    /// cref="PropagationCapability.Id"/>. Sparse orbital elements travel over
    /// the wire and each consumer derives position on demand from this, rather
    /// than position samples being streamed every tick.
    ///
    /// <para><b>Keyed on an identity and a frame, not on elements.</b> A
    /// <see cref="PropagationTarget"/> names the object and carries a conic only
    /// as the payload a two-body implementation needs, so an implementation
    /// backed by a different physics is not forced to reason in conics. The
    /// default provider is a two-body analytic solver.</para>
    ///
    /// <para>The members beyond <c>Solve</c> are not conveniences: an orbital
    /// period, a propagability predicate, a batch of solves and the closest
    /// approach all belong to whoever propagates, so that swapping the provider
    /// swaps every one of them.</para>
    ///
    /// <para><b>Closest approach is on this interface, and it has to be.</b> An
    /// encounter is a CONSEQUENCE of a trajectory. Whoever can propagate can say
    /// where two craft are closest, and whoever cannot says it in conics
    /// precisely because their propagation is conic. One election means an
    /// integrated trajectory and a two-body encounter for the same vessel at the
    /// same instant cannot both be on the wire.</para>
    ///
    /// <para>An implementation returns results for a
    /// <see cref="PropagationTarget"/> in a <see cref="PropagationFrame"/> at a
    /// UT, and every result must be
    /// DETERMINISTIC (same inputs, same outputs, no wall-clock and no
    /// randomness), because callers cache results, compare two of them, and
    /// draw the difference. What is not supported is declined through <see
    /// cref="CanPropagate(PropagationTarget, PropagationFrame, double,
    /// double)"/> rather than approximated: a two-body result for an n-body
    /// question looks exactly like a right one on screen.</para>
    ///
    /// <para>A stock install has a provider and so does an n-body one; core
    /// resolves this interface and never learns which is installed, which is
    /// what keeps the rest of the mod free of any particular physics.</para>
    /// </summary>
    /// <category>Propagation and models</category>
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
        /// <para>Exists for the visibility sweep, which takes on the order of
        /// 1440 samples per silence event on the capture tick. For an analytic
        /// solver this is a loop and the batch form buys nothing; for anything
        /// that integrates it is the difference between one pass and 1440, so
        /// the sweep must be able to ask this way even while the default
        /// provider does not need it.</para>
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
        /// <para>For a two-body ellipse these are periapsis and apoapsis. They
        /// are NOT named that here, deliberately: the conic words would carry
        /// the conic back into this interface's vocabulary, which is the thing
        /// the whole exercise exists to undo. Any craft under any physics has a
        /// closest and a furthest approach; only a two-body one has them at
        /// fixed apsides that <c>sma * (1 +/- ecc)</c> can be written out
        /// for.</para>
        ///
        /// <para>Null is a real result, on the same terms as <see
        /// cref="CharacteristicCycleSeconds"/>: a hyperbolic trajectory recedes
        /// forever and has no furthest point.</para>
        /// </summary>
        RadiusExtremes? RadiusExtremesOf(PropagationTarget target);

        /// <summary> Whether this provider can return a trustworthy result for <paramref
        /// name="target"/> in <paramref name="frame"/> across the window
        /// [<paramref name="fromUt"/>, <paramref name="toUt"/>].
        ///
        /// <para>Two independent reasons to refuse, and both matter. The target
        /// may be one this provider cannot describe at all (KSP gives the Sun
        /// <c>ecc = 1</c> and <c>sma = 0</c>, so the root body reaches this
        /// guard on every hierarchy walk that climbs to the star). Or the FRAME
        /// may be unreachable, or the window may run past a horizon beyond
        /// which the result stops being trustworthy. An analytic two-body
        /// solver has no such horizon; anything that integrates does, and the
        /// window is a parameter so that it can say so.</para>
        ///
        /// <para>This is the ONLY question a caller should ask before reaching
        /// for a frame centred on another body. A second predicate kept by the
        /// caller over the same walk would be free to disagree with the provider
        /// that performs it.</para>
        /// </summary>
        bool CanPropagate(PropagationTarget target, PropagationFrame frame, double fromUt, double toUt);

        /// <summary>
        /// The NEXT closest approach between <paramref name="subject"/> and
        /// <paramref name="other"/>: the first instant at or after
        /// <paramref name="fromUt"/> at which their separation stops shrinking
        /// and starts growing, and how far apart they are then. Null when there
        /// is no such instant before <paramref name="toUt"/>, and null when this
        /// provider declines either target or the frame. A null is the
        /// documented "nothing to say", never a sentinel zero-distance record.
        ///
        /// <para>The FIRST such instant, deliberately, not the smallest
        /// separation in the window. An operator flying a rendezvous is asking
        /// what happens next; a deeper approach three orbits later is a different
        /// question and would read as a wrong result for this one.</para>
        ///
        /// <para><b>Both objects are named, not described.</b> Named targets, a
        /// frame and a bounded window are the same vocabulary the rest of this
        /// interface speaks, and they are enough for an integrator to compute
        /// the approach from its own trajectories rather than from KSP's
        /// two-body helper.</para>
        ///
        /// <para><b>Symmetric.</b> Swapping the two arguments must not change the
        /// result. The names distinguish the caller's point of view (the craft
        /// being reported on, and what it is approaching), nothing else.</para>
        ///
        /// <para><b>The window is a real bound, not a hint.</b> An encounter
        /// after <paramref name="toUt"/> is not a result, because a provider
        /// that integrates has a horizon past which it would be inventing one:
        /// the same reason <see cref="CanPropagate(PropagationTarget,
        /// PropagationFrame, double, double)"/> takes a window. A caller
        /// wanting "the next approach" derives one from <see
        /// cref="CharacteristicCycleSeconds"/> of both objects: long enough to
        /// reach past several cycles of the faster one, since an approach is
        /// rarely on the first pass, and short enough that a provider can still
        /// resolve that faster motion across it.</para>
        ///
        /// <para>Deterministic, on the same terms as <c>Solve</c>: same inputs,
        /// same result, no wall-clock and no random dependence. A provider that
        /// searches numerically must therefore derive its sampling from the
        /// arguments rather than from anything ambient.</para>
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

    /// <summary> Whether a caller will accept a result past the span the
    /// provider vouches for, which is a question about CERTIFICATION and not
    /// about which model ran.
    ///
    /// <para>Both values get the same model out of the same provider. Under an
    /// integrating provider that is the craft's conic either way, because there
    /// is no integrated point query to select. What differs is whether the
    /// caller is willing to read it past the point anybody stands behind it,
    /// which <see cref="IPropagationProvider.CanPropagate"/> already decides
    /// and which the caller has to state.</para>
    ///
    /// <para><b><see cref="Unspecified"/> is zero and means nothing was
    /// chosen.</b> Same rule as <c>TrajectoryKind</c>'s zero: a default value
    /// must never grant the permissive setting without anyone deciding.</para>
    /// </summary>
    /// <category>Orbits and trajectories</category>
    public enum PropagationCertification
    {
        /// <summary>Nobody chose. Callers refuse rather than pick on their
        /// behalf.</summary>
        Unspecified = 0,

        /// <summary>
        /// Return a result wherever the solver can reach, horizon or no horizon. What a
        /// PLANNING search wants: a transfer grid asks a two-body question about
        /// instants nobody has reached, on purpose, and a bound derived from how
        /// long osculating elements stand in for an integrated path is not a
        /// statement about that question.
        /// </summary>
        Unbounded = 1,

        /// <summary>
        /// Return results only across spans the provider vouches for, and decline
        /// past them. What an OPERATIONAL prediction wants: a reacquisition sweep
        /// quoting a UT read off arc nobody stands behind is a confident figure
        /// with nothing under it.
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
        /// parent frame, which is the only frame the majority of callers want.
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
