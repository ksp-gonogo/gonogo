using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// A craft's state at an instant, relative to the body it orbits, in the
    /// non-rotating Z-up frame centred on that body: what
    /// <see cref="IPropagationFromState.PropagateFromState"/> starts from.
    /// </summary>
    /// <category>Propagation and models</category>
    public readonly struct PropagationSeed
    {
        /// <param name="state">Position in metres and velocity in metres per second, relative to the body.</param>
        /// <param name="parentBodyIndex">The body, by its propagation index.</param>
        /// <param name="ut">The instant the state was true, in UT seconds.</param>
        /// <param name="mu">The body's gravitational parameter, in cubic metres per second squared.</param>
        public PropagationSeed(StateVector state, int parentBodyIndex, double ut, double mu)
        {
            State = state;
            ParentBodyIndex = parentBodyIndex;
            Ut = ut;
            Mu = mu;
        }

        /// <summary>Position in metres and velocity in metres per second, relative to the body.</summary>
        public StateVector State { get; }

        /// <summary>The body, by its propagation index.</summary>
        public int ParentBodyIndex { get; }

        /// <summary>The instant the state was true, in UT seconds.</summary>
        public double Ut { get; }

        /// <summary>The body's gravitational parameter, in cubic metres per second squared.</summary>
        public double Mu { get; }
    }

    /// <summary>
    /// The path a craft follows from a given state, or why there is none. Useful for
    /// drawing where a craft is going from what a command centre last heard.
    ///
    /// <para>Branch on <see cref="Solved"/>. <see cref="Kind"/> says whether the
    /// points are a conic or an integrated path, and <see cref="ReachedUt"/> says how
    /// far they go, which can be short of the instant asked for.</para>
    /// </summary>
    /// <category>Orbits and trajectories</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class PropagatedPath
    {
        /// <summary>How many points a path carries when the caller leaves the count at zero.</summary>
        public const int DefaultPoints = 128;

        /// <summary>True when <see cref="States"/> holds a path; false when
        /// <see cref="Refusal"/> says why it does not.</summary>
        [SitrepUnit(Units.Flag)]
        public bool Solved { get; set; }

        /// <summary>What the points are: <see cref="TrajectoryKind.Analytic"/> for a
        /// conic, <see cref="TrajectoryKind.Integrated"/> for an integrated path.
        /// <see cref="TrajectoryKind.Unspecified"/> on a refusal.</summary>
        [SitrepUnit(Units.Enumeration)]
        public TrajectoryKind Kind { get; set; }

        /// <summary>The body the points are relative to, by its propagation index.</summary>
        [SitrepUnit(Units.Id)]
        public int CentreBodyIndex { get; set; }

        /// <summary>The points in ascending time, first at the seed's instant. Empty
        /// on a refusal.</summary>
        public List<BodyState> States { get; set; } = new();

        /// <summary>The instant the last point is at. Null on a refusal.</summary>
        [SitrepUnit(Units.UniversalTime)]
        public double? ReachedUt { get; set; }

        /// <summary>Why there is no path, as a sentence. Null when there is one.</summary>
        [SitrepUnit(Units.Text)]
        public string? Refusal { get; set; }

        /// <summary>True when there is no path yet but asking again shortly will find
        /// one, because the provider is still working on it. Keep drawing what you have.
        /// False on every other refusal and on a path.</summary>
        [SitrepUnit(Units.Flag)]
        public bool StillWorking { get; set; }

        /// <summary>A path carrying no points.</summary>
        /// <param name="why">Why there is none, as a sentence.</param>
        public static PropagatedPath Refused(string why) =>
            new PropagatedPath { Solved = false, Refusal = why };

        /// <summary>No path yet, and asking again shortly will find one.</summary>
        /// <param name="why">What it is waiting on, as a sentence.</param>
        public static PropagatedPath Working(string why) =>
            new PropagatedPath { Solved = false, StillWorking = true, Refusal = why };
    }

    /// <summary>
    /// Args for <c>vessel.trajectory.fromLastKnown</c>: where the active craft goes
    /// from the state this command centre last heard.
    ///
    /// <para>There is no field for the seed or the command centre: both come from the
    /// connection the command arrives on, so a client cannot start a path from
    /// anything that centre has not been told.</para>
    /// </summary>
    /// <category>Command arguments</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    [SitrepCommand(
        "vessel.trajectory.fromLastKnown",
        Result = typeof(LastKnownPathReply),
        Delay = DelayRole.TrueNow)]
    public class LastKnownPathRequest
    {
        /// <summary>Where to stop. May be past the centre's own view of the craft,
        /// which is what a prediction is for.</summary>
        [SitrepUnit(Units.UniversalTime)]
        public double ToUt { get; set; }

        /// <summary>The most points to return. Zero takes the default.</summary>
        [SitrepUnit(Units.Count)]
        public int MaxPoints { get; set; }

        /// <summary>
        /// Whether the analytic answer will do: only
        /// <see cref="PropagationCertification.Unbounded"/> accepts it. Every other
        /// value, the default <see cref="PropagationCertification.Unspecified"/>
        /// included, asks for the accurate answer, which a provider that integrates
        /// gives by integrating, or refuses.
        /// </summary>
        [SitrepUnit(Units.Enumeration)]
        public PropagationCertification Certification { get; set; }
    }

    /// <summary>
    /// The <c>vessel.trajectory.fromLastKnown</c> result: the path from what the
    /// asking command centre last heard, or why there is none. Read
    /// <see cref="SeededAtUt"/> with the path: it is only as current as the state it
    /// started from.
    /// </summary>
    /// <category>Orbits and trajectories</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class LastKnownPathReply
    {
        /// <summary>True when <see cref="Path"/> holds a path; false when
        /// <see cref="Refusal"/> says why it does not.</summary>
        [SitrepUnit(Units.Flag)]
        public bool Solved { get; set; }

        /// <summary>The path. Null on a refusal.</summary>
        public PropagatedPath? Path { get; set; }

        /// <summary>The instant the starting state was true. Null on a refusal.</summary>
        [SitrepUnit(Units.UniversalTime)]
        public double? SeededAtUt { get; set; }

        /// <summary>The command centre whose view this came from, so a client that
        /// switched centre can tell whose answer it holds. Null on a refusal.</summary>
        [SitrepUnit(Units.Id)]
        public string? Vantage { get; set; }

        /// <summary>Why there is no path, as a sentence. Null when there is one.</summary>
        [SitrepUnit(Units.Text)]
        public string? Refusal { get; set; }

        /// <summary>True when there is no path yet but asking again shortly will find
        /// one. Keep drawing what you have. False on every other refusal and on a
        /// path.</summary>
        [SitrepUnit(Units.Flag)]
        public bool StillWorking { get; set; }

        /// <summary>A reply carrying no path.</summary>
        /// <param name="why">Why there is none, as a sentence.</param>
        public static LastKnownPathReply Refused(string why) =>
            new LastKnownPathReply { Solved = false, Refusal = why };
    }
}
