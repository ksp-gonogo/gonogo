using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The force model an n-body propagation runs against: one entry per body,
    /// with the parameters an acceleration needs.
    ///
    /// <para>Read from the installed physics mod's own configuration, not
    /// invented: such a mod's numbers differ from stock's, carrying reference
    /// radii and geopotential terms where stock has a single GM per body.</para>
    ///
    /// <para>Plain data with no reader attached. The Uplink that can see the
    /// configuration fills one in and publishes it through
    /// <see cref="IGravityModelSource"/>.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public sealed class GravityModel
    {
        /// <summary>Builds a model. Throws <see cref="ArgumentNullException"/> when either argument is null.</summary>
        /// <param name="modelId">The value of <see cref="ModelId"/>.</param>
        /// <param name="bodies">The value of <see cref="Bodies"/>.</param>
        public GravityModel(string modelId, IReadOnlyList<GravityModelBody> bodies)
        {
            ModelId = modelId ?? throw new ArgumentNullException(nameof(modelId));
            Bodies = bodies ?? throw new ArgumentNullException(nameof(bodies));
        }

        /// <summary>
        /// Which model this is, for the provenance that travels on a published
        /// curve. A display name: do not branch on it.
        /// </summary>
        public string ModelId { get; }

        /// <summary>Every body the model describes, in the order it was read.</summary>
        public IReadOnlyList<GravityModelBody> Bodies { get; }

        /// <summary>
        /// The body of that name, or null when the model does not describe one.
        ///
        /// <para>Matched by exact, case-sensitive name. Null or empty
        /// <paramref name="name"/> returns null. A null result degrades a curve
        /// rather than stopping it: the missing body is a term left out, and the
        /// published arc says which term is missing.</para>
        /// </summary>
        /// <param name="name">The body's KSP name, for example <c>"Kerbin"</c>.</param>
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
    /// <category>Propagation and models</category>
    public sealed class GravityModelBody
    {
        /// <summary>Builds one body's entry. Throws <see cref="ArgumentNullException"/> when <paramref name="name"/> is null.</summary>
        /// <param name="name">The value of <see cref="Name"/>.</param>
        /// <param name="gravitationalParameter">The value of <see cref="GravitationalParameter"/>, in m³/s².</param>
        /// <param name="referenceRadius">The value of <see cref="ReferenceRadius"/>, in metres; null for a point mass.</param>
        /// <param name="j2">The value of <see cref="J2"/>; null when the model states none.</param>
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

        /// <summary>The body's KSP name (for example <c>"Kerbin"</c>), the key <see cref="GravityModel.Find"/> matches on.</summary>
        public string Name { get; }

        /// <summary>GM, in metres cubed per second squared.</summary>
        public double GravitationalParameter { get; }

        /// <summary>
        /// The radius the geopotential coefficients are referred to, in metres, when
        /// the model states one. Null for a body described as a point mass.
        /// </summary>
        public double? ReferenceRadius { get; }

        /// <summary>
        /// The second zonal harmonic, when the model states one.
        ///
        /// <para>Carried but not summed into the acceleration, so a published curve
        /// states a geopotential degree of zero.
        /// <internal>It is worth about 4e-8 of a reference frame's angular velocity
        /// at lunar distance, four orders of magnitude below the third-body terms
        /// that dominate the same quantity, so computing it buys nothing measurable
        /// and costs a per-step branch.</internal></para>
        /// </summary>
        public double? J2 { get; }
    }

    /// <summary>
    /// A capability that supplies the force model an n-body propagation runs
    /// against.
    ///
    /// <para>The Uplink for the installed physics mod reads that mod's
    /// configuration and publishes the result through this interface; the mod
    /// resolves the interface and never needs to know which physics mod it
    /// is.</para>
    ///
    /// <para><see cref="Model"/> is null when the configuration could not be found
    /// or could not be parsed. That is not a gap to fill with defaults: a client
    /// is told about it as <see cref="TrajectoryRefusal.NoForceModel"/>, an install
    /// problem with no operator remedy. Substituting stock's values would give a
    /// curve that looks right and is not.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public interface IGravityModelSource : ISitrepProvider
    {
        /// <summary>
        /// The gravity model in force for the loaded game, or <c>null</c> when this
        /// source cannot describe one.
        ///
        /// <para>Null means the source cannot describe a model, never "there is no
        /// gravity". It changes on a game load and not otherwise, so a caller may
        /// hold the value for the life of a game and must re-read across a
        /// load.</para>
        /// </summary>
        GravityModel? Model { get; }
    }

    /// <summary>
    /// The capability id an <see cref="IGravityModelSource"/> competes for.
    ///
    /// <para>Register the provider under this constant rather than a copy of the
    /// string: a provider registered under any other id is never resolved, and
    /// the only symptom is a curve that never arrives.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public static class GravityModelCapability
    {
        /// <summary>The capability id, <c>"gravityModel"</c>.</summary>
        public const string Id = "gravityModel";
    }

    /// <summary>
    /// A capability that can hand back the actual points of a trajectory.
    ///
    /// <para>A separate interface rather than a method on
    /// <see cref="IPropagationProvider"/>, like <see cref="IIntegratedTrajectorySource"/>:
    /// an analytic provider's elements are its curve, so it has no arc to give
    /// and does not implement this.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public interface ITrajectoryArcSource
    {
        /// <summary>
        /// The path <paramref name="target"/> flies across
        /// [<paramref name="fromUt"/>, <paramref name="toUt"/>], or a stated refusal.
        ///
        /// <para>Never throws for an ordinary refusal. A provider that ran out of
        /// budget or has no force model says so in the result, because both are
        /// states an operator is told about rather than faults.</para>
        /// </summary>
        /// <param name="target">The vessel or body whose path is wanted.</param>
        /// <param name="fromUt">Start of the span, in seconds of universal time.</param>
        /// <param name="toUt">End of the span, in seconds of universal time.</param>
        /// <param name="maxPoints">The most points the returned arc may carry.</param>
        TrajectoryArcAnswer ArcFor(
            PropagationTarget target,
            double fromUt,
            double toUt,
            int maxPoints);
    }

    /// <summary>
    /// What an arc request came back with: a path, or the reason there is none.
    ///
    /// <para>Never an empty path: a drawn arc has at least two points, and
    /// "there is no trajectory" is a refusal with a reason.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public readonly struct TrajectoryArcAnswer
    {
        private TrajectoryArcAnswer(TrajectoryArc? arc, TrajectoryRefusal refusal)
        {
            Arc = arc;
            Refusal = refusal;
        }

        /// <summary>The computed path, at least two points long. Null when <see cref="Refusal"/> says why there is none.</summary>
        public TrajectoryArc? Arc { get; }

        /// <summary>
        /// Why there is no <see cref="Arc"/>: <see cref="TrajectoryRefusal.NotRefused"/>
        /// when one was drawn, <see cref="TrajectoryRefusal.NotAttempted"/> when
        /// none was sought, otherwise the stated reason.
        /// </summary>
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
