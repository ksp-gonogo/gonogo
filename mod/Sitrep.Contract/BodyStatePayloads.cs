using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// Args for <c>system.bodies.statesAt</c>: where is this body at each of these
    /// instants, from whichever propagation provider the install elected.
    ///
    /// <para><b>Why a command and not a channel.</b> The instants are the caller's,
    /// not the game's: a transfer search asks about departure and arrival times
    /// nobody has reached and may never reach. Nothing publishes an answer to a
    /// question that has not been asked, so this is a query, the same shape
    /// <c>vessel.trajectory.forVantage</c> uses for the same reason.</para>
    ///
    /// <para><b>No vantage field, for the reason the trajectory query gives:</b> a
    /// client that could name one could name somebody else's and be shown what they
    /// can see. It is resolved where the command enters instead.</para>
    ///
    /// <para><b>A centre body IS named, and has to be.</b> The answer is expressed
    /// relative to whatever body you name, and there is no default: a transfer
    /// search wants both endpoints about the parent they share, and saying which
    /// body that is also lets one request serve a moon system as readily as a
    /// solar one.
    /// <internal>
    /// There is nothing to default TO. A provider answers by walking the body
    /// hierarchy between target and frame centre, and
    /// <see cref="PropagationTarget.Body"/> leaves <c>ParentBodyIndex</c> at -1,
    /// so a convenience overload would have no parent on the target to resolve.
    /// </internal></para>
    ///
    /// <para><b>The model is ASKED FOR, never inherited.</b> A transfer search
    /// wants the two-body answer because that is what it is designed around, and
    /// it wants it whatever an install's provider would otherwise hand back. So
    /// <see cref="Model"/> is part of the question rather than a property of
    /// whoever answers it, and a request that does not name one is refused: a
    /// planning grid that silently changed model when a default moved underneath
    /// it would look like the transfer changed.</para>
    ///
    /// <para>No horizon applies to the analytical answer, and that follows from
    /// what a horizon IS: an ephemeris horizon bounds how long osculating elements
    /// still stand in for an integrated path, and a conic search is not claiming
    /// to be that path.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    [SitrepCommand(
        "system.bodies.statesAt",
        Result = typeof(BodyStatesReply),
        Delay = DelayRole.TrueNow)]
    public class BodyStatesRequest
    {
        /// <summary>The body, by its <c>system.bodies</c> index.</summary>
        [SitrepUnit(Units.Id)]
        public int BodyIndex { get; set; }

        /// <summary>
        /// The body the answer is expressed relative to, by the same index. For a
        /// transfer search this is the parent both endpoints orbit.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public int CentreBodyIndex { get; set; }

        /// <summary>
        /// The instants to solve for, in UT seconds. Answered in the order given,
        /// so a caller can zip the reply against its own grid without matching on
        /// a time it would have to compare as a float.
        /// </summary>
        [SitrepUnit(Units.UniversalTime)]
        public List<double> Uts { get; set; } = new();

        /// <summary>
        /// Which model the answer must come from.
        /// <see cref="TrajectoryKind.Unspecified"/> is refused rather than
        /// defaulted, for the reason that enum's own zero exists: a caller that
        /// says nothing gets told to say something, instead of silently
        /// inheriting whatever this install would otherwise have produced.
        /// <internal>
        /// <see cref="TrajectoryKind.Integrated"/> is refused too, today: every
        /// provider forwards a body solve to its conics, so there is no
        /// integrated body answer to give and handing back a conic under that
        /// name would be a lie the client cannot detect. The refusal is what
        /// makes this field honest before the seam can carry a model at all.
        /// </internal>
        /// </summary>
        [SitrepUnit(Units.Enumeration)]
        public TrajectoryKind Model { get; set; }
    }

    /// <summary>
    /// The answer, or why there is not one.
    ///
    /// <para><see cref="Solved"/> is the discriminator and is never inferred from an
    /// empty list: a body the provider could not place and a caller that asked about
    /// no instants are different facts, and a search that read them the same would
    /// draw an empty plot for an install problem.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class BodyStatesReply
    {
        [SitrepUnit(Units.Flag)]
        public bool Solved { get; set; }

        /// <summary>One state per requested instant, in the order asked.</summary>
        public List<BodyState> States { get; set; } = new();

        /// <summary>
        /// Which provider answered, so a reading that looks wrong can be attributed
        /// without guessing at the install.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string? ProviderId { get; set; }

        /// <summary>Why there is no answer, when <see cref="Solved"/> is false.</summary>
        [SitrepUnit(Units.Text)]
        public string? Refusal { get; set; }

        /// <summary>
        /// A refusal, said in words a reader can act on. The states list stays
        /// empty: an unsolved reply with points in it would be read as a partial
        /// answer, and there is no such thing here.
        /// </summary>
        public static BodyStatesReply Refused(string why) =>
            new BodyStatesReply { Solved = false, Refusal = why };
    }

    /// <summary>
    /// One body's position and velocity at one instant, relative to the request's
    /// centre body.
    ///
    /// <para>Flat keys rather than nested vectors, matching
    /// <see cref="TrajectoryPoint"/>: these arrive in bulk and the wire cost of a
    /// nested object per point is paid on every cell of every grid.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class BodyState
    {
        /// <summary>The instant this state is at, echoing the request.</summary>
        [SitrepUnit(Units.UniversalTime)]
        public double Ut { get; set; }

        [SitrepUnit(Units.Metres)]
        public double X { get; set; }

        [SitrepUnit(Units.Metres)]
        public double Y { get; set; }

        [SitrepUnit(Units.Metres)]
        public double Z { get; set; }

        [SitrepUnit(Units.MetresPerSecond)]
        public double Vx { get; set; }

        [SitrepUnit(Units.MetresPerSecond)]
        public double Vy { get; set; }

        [SitrepUnit(Units.MetresPerSecond)]
        public double Vz { get; set; }
    }
}
