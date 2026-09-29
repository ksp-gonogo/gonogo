#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary> Args for <c>vessel.trajectory.forVantage</c>: where does this
    /// craft go, given what my command centre has been told.
    ///
    /// <para>There is no vantage field: the reply is computed for the vantage
    /// the command arrives from, so a client cannot ask for what another
    /// command centre can see.</para>
    /// </summary>
    /// <category>Command arguments</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    [SitrepCommand("vessel.trajectory.forVantage", Result = typeof(VantagePlanReply), Delay = DelayRole.TrueNow)]
    public class VantagePlanRequest
    {
        /// <summary>The channel carrying the craft's orbit. A request naming no
        /// topic is refused.</summary>
        [SitrepUnit(Units.Id)]
        public string? Topic { get; set; }

        /// <summary> How far ahead to propagate. Allowed to be past what this
        /// vantage can currently see, because a prediction reaching beyond the
        /// news is the whole point of asking.
        /// </summary>
        [SitrepUnit(Units.UniversalTime)]
        public double ToUt { get; set; }

        /// <summary>Points to publish on the arc. Zero takes the provider's
        /// default.</summary>
        [SitrepUnit(Units.Count)]
        public int MaxPoints { get; set; }
    }

    /// <summary>
    /// The <c>vessel.trajectory.forVantage</c> result: the craft's predicted
    /// trajectory as the asking command centre knows it, or why there is not
    /// one.
    ///
    /// <para>Read <see cref="SeededAtUt"/> with the arc: an arc detached from the
    /// instant its seed was true makes no claim about when, and a divergence
    /// measured against it later would be measured against nothing in
    /// particular.</para>
    /// </summary>
    /// <category>Orbits and trajectories</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class VantagePlanReply
    {
        /// <summary>Whether a trajectory was computed. When false,
        /// <see cref="Refusal"/> says why and the other fields are null.</summary>
        [SitrepUnit(Units.Flag)]
        public bool Solved { get; set; }

        /// <summary>The predicted path up to the requested UT. Null when
        /// <see cref="Solved"/> is false.</summary>
        public TrajectoryArc? Arc { get; set; }

        /// <summary>When the state this was computed from was actually
        /// TRUE.</summary>
        [SitrepUnit(Units.UniversalTime)]
        public double? SeededAtUt { get; set; }

        /// <summary>Which command centre's view produced it, echoed so a client
        /// that switched vantage mid-flight can tell whose result it is
        /// holding. Null on a refusal.</summary>
        [SitrepUnit(Units.Id)]
        public string? Vantage { get; set; }

        /// <summary>Why there is no trajectory, as a human-readable sentence. Null
        /// when there is one.</summary>
        [SitrepUnit(Units.Text)]
        public string? Refusal { get; set; }

        /// <summary>A reply carrying no trajectory.</summary>
        /// <param name="refusal">Why there is none, as a human-readable sentence.</param>
        /// <returns>An unsolved reply.</returns>
        public static VantagePlanReply Refused(string refusal) =>
            new VantagePlanReply { Solved = false, Refusal = refusal };

        /// <summary>A solved reply from a seeded propagation's result.</summary>
        /// <param name="answer">The solved trajectory and the UT its seed was true at.</param>
        /// <param name="vantage">The command centre whose view produced it.</param>
        /// <returns>A solved reply.</returns>
        public static VantagePlanReply From(SeededTrajectory answer, string vantage) =>
            new VantagePlanReply
            {
                Solved = true,
                Arc = answer.Arc,
                SeededAtUt = answer.SeededAtUt,
                Vantage = vantage,
            };
    }
}
