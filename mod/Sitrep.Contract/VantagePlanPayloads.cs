#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// Args for <c>vessel.trajectory.forVantage</c>: where does this craft go, given
    /// what my command centre has been told.
    ///
    /// <para>There is deliberately no vantage field. The answer depends on who is
    /// asking, and a client that could name its own vantage could name somebody
    /// else's and be shown what they can see. It is resolved where the command
    /// enters instead.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    [SitrepCommand("vessel.trajectory.forVantage", Result = typeof(VantagePlanReply))]
    public class VantagePlanRequest
    {
        /// <summary>The channel carrying the craft's orbit.</summary>
        [SitrepUnit(Units.Id)]
        public string? Topic { get; set; }

        /// <summary>
        /// How far ahead to propagate. Allowed to be past what this vantage can
        /// currently see, because a prediction reaching beyond the news is the whole
        /// point of asking.
        /// </summary>
        [SitrepUnit(Units.UniversalTime)]
        public double ToUt { get; set; }

        /// <summary>Points to publish on the arc. Zero takes the provider's default.</summary>
        [SitrepUnit(Units.Count)]
        public int MaxPoints { get; set; }
    }

    /// <summary>
    /// The answer, or why there is not one.
    ///
    /// <para><see cref="SeededAtUt"/> is not decoration. An arc detached from the
    /// instant its seed was true is a path with no claim about when, and a divergence
    /// measured against it later would be measured against nothing in particular.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class VantagePlanReply
    {
        [SitrepUnit(Units.Flag)]
        public bool Solved { get; set; }

        public TrajectoryArc? Arc { get; set; }

        /// <summary>When the state this was computed from was actually TRUE.</summary>
        [SitrepUnit(Units.UniversalTime)]
        public double? SeededAtUt { get; set; }

        /// <summary>Which command centre's view produced it, echoed so a client that
        /// switched vantage mid-flight can tell whose answer it is holding.</summary>
        [SitrepUnit(Units.Id)]
        public string? Vantage { get; set; }

        /// <summary>Why there is no trajectory. Null when there is one.</summary>
        [SitrepUnit(Units.Text)]
        public string? Refusal { get; set; }

        public static VantagePlanReply Refused(string refusal) =>
            new VantagePlanReply { Solved = false, Refusal = refusal };

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
