using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The force model an n-body propagation runs against: one entry per body,
    /// with the parameters an acceleration needs.
    ///
    /// <para><b>Read rather than invented.</b> A mod that replaces stock's physics
    /// ships its own gravity model as configuration, and the numbers in it are not
    /// the numbers stock uses: they carry real reference radii and geopotential
    /// terms where stock has a single GM per body. Integrating against stock's
    /// values and calling the result n-body would produce a curve that agrees with
    /// nothing.</para>
    ///
    /// <para>Plain data with no reader attached, because the reading is a game call
    /// and this is the KSP-free vocabulary the propagator speaks. Whoever can see
    /// the configuration fills one of these in and publishes it through
    /// <see cref="IGravityModelSource"/>.</para>
    /// </summary>
    public sealed class GravityModel
    {
        public GravityModel(string modelId, IReadOnlyList<GravityModelBody> bodies)
        {
            ModelId = modelId ?? throw new ArgumentNullException(nameof(modelId));
            Bodies = bodies ?? throw new ArgumentNullException(nameof(bodies));
        }

        /// <summary>
        /// Which model this is, for the provenance that travels on a published
        /// curve. A name, so nothing outside an election may branch on it.
        /// </summary>
        public string ModelId { get; }

        /// <summary>Every body the model describes, in the order it was read.</summary>
        public IReadOnlyList<GravityModelBody> Bodies { get; }

        /// <summary>
        /// The body of that name, or null when the model does not describe one.
        ///
        /// <para>Null is the answer that DEGRADES a curve rather than one that
        /// stops it: a perturber we cannot resolve is a term we cannot include, and
        /// the published arc says which term is missing rather than quietly
        /// summing one fewer body.</para>
        /// </summary>
        public GravityModelBody? Find(string? name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            for (var i = 0; i < Bodies.Count; i++)
            {
                if (string.Equals(Bodies[i].Name, name, StringComparison.Ordinal))
                {
                    return Bodies[i];
                }
            }
            return null;
        }
    }

    /// <summary>One body's gravitational parameters, as the model states them.</summary>
    public sealed class GravityModelBody
    {
        public GravityModelBody(
            string name,
            double gravitationalParameter,
            double? referenceRadius = null,
            double? j2 = null)
        {
            Name = name ?? throw new ArgumentNullException(nameof(name));
            GravitationalParameter = gravitationalParameter;
            ReferenceRadius = referenceRadius;
            J2 = j2;
        }

        public string Name { get; }

        /// <summary>GM, in metres cubed per second squared.</summary>
        public double GravitationalParameter { get; }

        /// <summary>
        /// The radius the geopotential coefficients are referred to, when the model
        /// states one. Null for a body described as a point mass.
        /// </summary>
        public double? ReferenceRadius { get; }

        /// <summary>
        /// The second zonal harmonic, when the model states one.
        ///
        /// <para>Carried and deliberately NOT summed into the acceleration. It is
        /// worth about 4e-8 of a reference frame's angular velocity at lunar
        /// distance, four orders of magnitude below the third-body terms that
        /// dominate the same quantity, so computing it buys nothing measurable and
        /// costs a per-step branch. A published curve states the geopotential degree
        /// it used, and it says zero.</para>
        /// </summary>
        public double? J2 { get; }
    }

    /// <summary>
    /// A capability that supplies the force model an n-body propagation runs
    /// against.
    ///
    /// <para><b>Why it is a capability rather than a read core performs.</b> Core
    /// has no business knowing which physics mod is installed, and the
    /// configuration this comes out of belongs to whichever one is. An Uplink knows
    /// its own mod, reads its own configuration, and publishes the result through
    /// this interface; core resolves the interface and never learns a name.</para>
    ///
    /// <para><see cref="Model"/> is null when the configuration could not be found
    /// or could not be parsed. That null is not a gap to fill with defaults: it is
    /// the state a client is told about as <see cref="TrajectoryRefusal.NoForceModel"/>,
    /// which is an install problem with no operator remedy, and substituting stock's
    /// values for it would answer with a curve that agrees with nothing while
    /// looking exactly like one that does.</para>
    /// </summary>
    public interface IGravityModelSource : ISitrepProvider
    {
        GravityModel? Model { get; }
    }

    /// <summary>
    /// The capability id an <see cref="IGravityModelSource"/> competes for.
    ///
    /// <para>Declared HERE rather than at the election, which is core's and so out
    /// of an Uplink's reach. A registering Uplink and the election that resolves it
    /// have to agree on this string exactly, and a second copy of it on the far
    /// side of a boundary neither can compile across is a copy free to disagree
    /// silently: the provider registers, nothing resolves it, and the only symptom
    /// is a curve that never arrives.</para>
    /// </summary>
    public static class GravityModelCapability
    {
        public const string Id = "gravityModel";
    }

    /// <summary>
    /// A capability that can hand back the actual points of a trajectory.
    ///
    /// <para>Answered by a TYPE rather than by a method on
    /// <see cref="IPropagationProvider"/>, on the same reasoning as
    /// <c>IIntegratedTrajectorySource</c>: an analytic provider has no arc to give
    /// and should not be made to say so, because its elements ARE its curve and a
    /// sampled copy of them beside the elements is a second, redundant answer that
    /// can drift from the first.</para>
    /// </summary>
    public interface ITrajectoryArcSource
    {
        /// <summary>
        /// The path <paramref name="target"/> flies across
        /// [<paramref name="fromUt"/>, <paramref name="toUt"/>], or a stated refusal.
        ///
        /// <para>Never throws for an ordinary refusal. A provider that ran out of
        /// budget or has no force model says so in the answer, because both are
        /// states an operator is told about rather than faults.</para>
        /// </summary>
        TrajectoryArcAnswer ArcFor(
            PropagationTarget target,
            double fromUt,
            double toUt,
            int maxPoints);
    }

    /// <summary>
    /// What an arc request came back with: a path, or the reason there is none.
    ///
    /// <para>Deliberately never an empty path. "Here is a trajectory with no points
    /// in it" and "there is no trajectory to draw" read identically on a diagram
    /// and mean opposite things, so the shape makes the second expressible without
    /// the first.</para>
    /// </summary>
    public readonly struct TrajectoryArcAnswer
    {
        private TrajectoryArcAnswer(TrajectoryArc? arc, TrajectoryRefusal refusal)
        {
            Arc = arc;
            Refusal = refusal;
        }

        public TrajectoryArc? Arc { get; }

        public TrajectoryRefusal Refusal { get; }

        /// <summary>An arc that was computed. Throws on an empty one rather than publishing it.</summary>
        public static TrajectoryArcAnswer Drawn(TrajectoryArc arc)
        {
            if (arc == null) throw new ArgumentNullException(nameof(arc));
            if (arc.Points.Count < 2)
            {
                throw new ArgumentException(
                    "An arc of fewer than two points is not a path. Refuse instead: an empty " +
                    "path and an absent trajectory render identically and mean opposite things.",
                    nameof(arc));
            }
            return new TrajectoryArcAnswer(arc, TrajectoryRefusal.NotRefused);
        }

        /// <summary>
        /// No arc, and the reason. The two reasons that are not refusals are
        /// themselves refused here: a refusal with no reason is silence, and a
        /// refusal claiming nothing refused it is a contradiction.
        /// </summary>
        public static TrajectoryArcAnswer Refused(TrajectoryRefusal reason)
        {
            if (reason == TrajectoryRefusal.NotAttempted
                || reason == TrajectoryRefusal.NotRefused)
            {
                throw new ArgumentException(
                    "A refusal has to name its reason. NotAttempted is what a producer that " +
                    "never sought an arc sends and NotRefused accompanies one that was drawn, " +
                    "so neither can stand in for a stated refusal.",
                    nameof(reason));
            }
            return new TrajectoryArcAnswer(null, reason);
        }

        /// <summary>Nothing was sought, which is every sample from a provider that does not integrate.</summary>
        public static TrajectoryArcAnswer NotAttempted() =>
            new TrajectoryArcAnswer(null, TrajectoryRefusal.NotAttempted);
    }
}
