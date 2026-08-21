using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// A capability that answers where something is at a given UT. This is the
    /// dead-reckoning foundation for the streaming model: we transmit sparse
    /// orbital elements over the wire and let each consumer (the mod, the SDK)
    /// derive position on demand, rather than streaming dense position samples
    /// every tick.
    ///
    /// <para>Deliberately an interface, not a static method: propagation is a
    /// swappable capability. <see cref="KeplerProvider"/> is the two-body analytic
    /// solver used by default; a provider backed by a different physics is a second
    /// implementation of this same contract.</para>
    ///
    /// <para><b>Keyed on an identity and a frame, not on elements.</b> An earlier
    /// shape of this interface took <see cref="OrbitElements"/> directly, which
    /// meant the argument itself was the two-body assumption: an implementation
    /// handed a conic can answer only in conics, however it works internally. A
    /// <see cref="PropagationTarget"/> names the object instead and carries the
    /// conic only as the payload this particular implementation needs.</para>
    ///
    /// <para><b>Everything a caller used to compute for itself is here.</b> The
    /// members beyond <c>Solve</c> are not conveniences. Each replaces arithmetic
    /// that was being done outside any provider, and so escaped every attempt to
    /// swap one: an orbital period from sma/mu, a propagability predicate from
    /// ecc/sma/mu, a batch of solves run one at a time in the visibility sweep's
    /// inner loop, and a closest approach that used to be a capability of its
    /// own.</para>
    ///
    /// <para><b>Closest approach is on this interface, and it has to be.</b> It
    /// was a sibling capability with its own election for a while, which modelled
    /// the two as unrelated. They are not: an encounter is a CONSEQUENCE of a
    /// trajectory. Whoever can propagate can answer where two craft are closest,
    /// and whoever cannot answers in conics precisely because their propagation
    /// is conic. Two elections could disagree, and the failure had no symptom: an
    /// integrated trajectory and a two-body encounter for the same vessel at the
    /// same instant, both on the wire, with nothing to tell them apart. One
    /// election cannot produce that pair.</para>
    /// </summary>
    public interface IPropagationProvider : ISitrepProvider
    {
        /// <summary>
        /// Solve for the state vector of <paramref name="target"/> at
        /// <paramref name="ut"/> (UT seconds), expressed in
        /// <paramref name="frame"/>. Must be deterministic: same inputs, same
        /// outputs, no wall-clock or random dependence.
        ///
        /// <para>Throws <see cref="NotSupportedException"/> when
        /// <see cref="CanPropagate(PropagationTarget, PropagationFrame, double, double)"/>
        /// would refuse. Callers on a hot path should ask first rather than catch.</para>
        /// </summary>
        StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut);

        /// <summary>
        /// The same question at many UTs, written into <paramref name="into"/>.
        ///
        /// <para>Exists for the visibility sweep, which takes on the order of 1440
        /// samples per silence event on the capture tick. For an analytic solver
        /// this is a loop and the batch form buys nothing; for anything that
        /// integrates it is the difference between one pass and 1440, so the sweep
        /// must be able to ask this way even while the default provider does not
        /// need it.</para>
        /// </summary>
        void SolveMany(
            PropagationTarget target,
            PropagationFrame frame,
            IReadOnlyList<double> uts,
            StateVector[] into);

        /// <summary>
        /// The characteristic timescale of the target's own motion, seconds, or
        /// null when its motion has no repeat.
        ///
        /// <para>For a two-body ellipse this is the orbital period. Null is a real
        /// answer and not a failure: a hyperbolic trajectory has no period, and
        /// neither does a general non-Keplerian one. Every caller of this already
        /// had a no-period branch before it existed, because each of the sites it
        /// replaces guarded on <c>ecc >= 1</c> and fell through to a fixed
        /// ceiling.</para>
        /// </summary>
        double? CharacteristicCycleSeconds(PropagationTarget target);

        /// <summary>
        /// How close in and how far out the target gets from the body it orbits,
        /// metres, or null when its motion has no such bound.
        ///
        /// <para>For a two-body ellipse these are periapsis and apoapsis. They are
        /// NOT named that here, deliberately: the conic words would carry the conic
        /// back into this interface's vocabulary, which is the thing the whole
        /// exercise exists to undo. Any craft under any physics has a closest and a
        /// furthest approach; only a two-body one has them at fixed apsides that
        /// <c>sma * (1 +/- ecc)</c> can be written out for.</para>
        ///
        /// <para>Null is a real answer, on the same terms as
        /// <see cref="CharacteristicCycleSeconds"/>: a hyperbolic trajectory recedes
        /// forever and has no furthest point.</para>
        /// </summary>
        RadiusExtremes? RadiusExtremesOf(PropagationTarget target);

        /// <summary>
        /// Whether this provider will answer honestly for <paramref name="target"/>
        /// in <paramref name="frame"/> across the window
        /// [<paramref name="fromUt"/>, <paramref name="toUt"/>].
        ///
        /// <para>Two independent reasons to refuse, and both matter. The target may
        /// be one this provider cannot describe at all (KSP gives the Sun
        /// <c>ecc = 1</c> and <c>sma = 0</c>, so the root body reaches this guard on
        /// every hierarchy walk that climbs to the star). Or the FRAME may be
        /// unreachable, or the window may run past a horizon beyond which the
        /// answer stops being trustworthy. An analytic two-body solver has no such
        /// horizon; anything that integrates does, and the window is a parameter so
        /// that it can say so.</para>
        ///
        /// <para>This is the ONLY question a caller should ask before reaching for a
        /// frame centred on another body. It replaced a predicate the visibility
        /// side kept over its own list of links, which was a second opinion about
        /// the same walk and so free to disagree with the provider that performs
        /// it.</para>
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
        /// question and would read as a wrong answer to this one.</para>
        ///
        /// <para><b>Both objects are named, not described.</b> That is the whole
        /// difference from the interface this replaces, whose only argument was a
        /// UT: a solver handed a bare instant has to reach for its own source of
        /// truth about who is involved, and the stock one reached for KSP's
        /// two-body helper because that was the nearest source to hand. Named
        /// targets, a frame and a bounded window are the same vocabulary the rest
        /// of this interface speaks, and they are enough for an integrator to
        /// answer from its own trajectories.</para>
        ///
        /// <para><b>Symmetric.</b> Swapping the two arguments must not change the
        /// answer. The names distinguish the caller's point of view (the craft
        /// being reported on, and what it is approaching), nothing else.</para>
        ///
        /// <para><b>The window is a real bound, not a hint.</b> An encounter
        /// after <paramref name="toUt"/> is not an answer, because a provider
        /// that integrates has a horizon past which it would be inventing one:
        /// the same reason
        /// <see cref="CanPropagate(PropagationTarget, PropagationFrame, double, double)"/>
        /// takes a window. A caller wanting "the next approach" derives one from
        /// <see cref="CharacteristicCycleSeconds"/> of both objects: long enough
        /// to reach past several cycles of the faster one, since an approach is
        /// rarely on the first pass, and short enough that a provider can still
        /// resolve that faster motion across it.</para>
        ///
        /// <para>Deterministic, on the same terms as <c>Solve</c>: same inputs,
        /// same answer, no wall-clock and no random dependence. A provider that
        /// searches numerically must therefore derive its sampling from the
        /// arguments rather than from anything ambient.</para>
        /// </summary>
        ClosestApproach? SolveClosestApproach(
            PropagationTarget subject,
            PropagationTarget other,
            PropagationFrame frame,
            double fromUt,
            double toUt);
    }

    /// <summary>Frame-free overloads for callers working in the target's own parent frame.</summary>
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

        /// <summary><see cref="IPropagationProvider.Solve"/> in the target's own parent frame.</summary>
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
