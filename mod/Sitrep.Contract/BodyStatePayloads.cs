using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// Args for <c>system.bodies.statesAt</c>: where one body is at each of a
    /// list of instants, from the propagation provider in use on this install.
    /// The instants are the caller's own, such as the departure and arrival
    /// times a transfer search tries.
    ///
    /// <para>The command centre is the sender's, taken from the connection the
    /// command arrives on; there is no field to name another.</para>
    ///
    /// <para>A centre body is required, with no default: the reply is
    /// expressed relative to it. For a transfer search, name the parent both
    /// endpoints orbit; the same request works for a moon system.</para>
    ///
    /// <para><see cref="Certification"/> is required too: the caller states
    /// whether it accepts results past the span the provider vouches for, and a
    /// request that does not say is refused.</para>
    ///
    /// <para>The result is a conic (two-body) solve, so no ephemeris horizon
    /// applies to it.</para>
    /// <internal>
    /// A command rather than a channel because nothing publishes a position for
    /// an instant nobody asked about. There is nothing to default the centre
    /// body to: a provider replies by walking the body hierarchy between target
    /// and frame centre, and <see cref="PropagationTarget.Body"/> leaves
    /// <c>ParentBodyIndex</c> at -1, so a convenience overload would have no
    /// parent on the target to resolve. A horizon bounds how long osculating
    /// elements stand in for an integrated path, which a conic solve does not
    /// claim to be.
    /// </internal>
    /// </summary>
    /// <category>Command arguments</category>
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
        /// The body the reply is expressed relative to, by the same index. For a
        /// transfer search this is the parent both endpoints orbit.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public int CentreBodyIndex { get; set; }

        /// <summary>
        /// The instants to solve for, in UT seconds. Returned in the order given,
        /// so a caller can zip the reply against its own grid without matching on
        /// a time it would have to compare as a float.
        /// </summary>
        [SitrepUnit(Units.UniversalTime)]
        public List<double> Uts { get; set; } = new();

        /// <summary>
        /// Whether this caller accepts a result past the span the provider
        /// vouches for. Only <see cref="PropagationCertification.Unbounded"/>
        /// is accepted.
        ///
        /// <para><see cref="PropagationCertification.Unspecified"/> is refused
        /// rather than defaulted, and so is
        /// <see cref="PropagationCertification.CertifiedOnly"/>, because the
        /// request carries instants with no origin to measure a span from.</para>
        /// <internal>
        /// <see cref="PropagationCertification.CertifiedOnly"/> is refused too,
        /// and not because it is unwanted: certification is a property of a
        /// SPAN (from one instant to another), and this request carries a bare
        /// list of instants with no origin to measure one from. Making it
        /// expressible means adding that origin, which is a change to the
        /// request rather than to the handler. Refusing is what keeps the field
        /// from appearing to offer something it cannot honour.
        /// </internal>
        /// </summary>
        [SitrepUnit(Units.Enumeration)]
        public PropagationCertification Certification { get; set; }
    }

    /// <summary>
    /// The reply to <c>system.bodies.statesAt</c>: the solved states, or why
    /// there are none.
    ///
    /// <para>Branch on <see cref="Solved"/>, never on an empty list: a body the
    /// provider could not place and a request that named no instants are
    /// different facts, and reading them the same draws an empty plot for an
    /// install problem.</para>
    /// </summary>
    /// <category>Orbits and trajectories</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class BodyStatesReply
    {
        /// <summary>True when the provider solved every requested instant and
        /// <see cref="States"/> holds them; false when the request was refused,
        /// with the reason in <see cref="Refusal"/>.</summary>
        [SitrepUnit(Units.Flag)]
        public bool Solved { get; set; }

        /// <summary>One state per requested instant, in the order
        /// asked. Empty when <see cref="Solved"/> is false.</summary>
        public List<BodyState> States { get; set; } = new();

        /// <summary>Id of the propagation provider that solved the request, so a
        /// reading that looks wrong can be attributed to it. Null on a refusal.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string? ProviderId { get; set; }

        /// <summary>Why the request was refused, in words a reader can act on,
        /// when <see cref="Solved"/> is false; null when it is true.</summary>
        [SitrepUnit(Units.Text)]
        public string? Refusal { get; set; }

        /// <summary>
        /// A refusal carrying <paramref name="why"/>, with <see cref="States"/>
        /// empty: there is no partial reply.
        /// </summary>
        public static BodyStatesReply Refused(string why) =>
            new BodyStatesReply { Solved = false, Refusal = why };
    }

    /// <summary>
    /// One body's position and velocity at one instant, relative to the request's
    /// centre body, in a non-rotating, Z-up inertial frame centred on that body.
    ///
    /// <para>Flat keys rather than nested vectors, because these arrive in
    /// bulk.</para>
    /// </summary>
    /// <category>Orbits and trajectories</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class BodyState
    {
        /// <summary>The instant this state is at, echoing the request.</summary>
        [SitrepUnit(Units.UniversalTime)]
        public double Ut { get; set; }

        /// <summary>Position along the frame's X axis, metres from the centre body.</summary>
        [SitrepUnit(Units.Metres)]
        public double X { get; set; }

        /// <summary>Position along the frame's Y axis, metres from the centre body.</summary>
        [SitrepUnit(Units.Metres)]
        public double Y { get; set; }

        /// <summary>Position along the frame's Z (up) axis, metres from the centre body.</summary>
        [SitrepUnit(Units.Metres)]
        public double Z { get; set; }

        /// <summary>Velocity along the frame's X axis, m/s, relative to the centre body.</summary>
        [SitrepUnit(Units.MetresPerSecond)]
        public double Vx { get; set; }

        /// <summary>Velocity along the frame's Y axis, m/s, relative to the centre body.</summary>
        [SitrepUnit(Units.MetresPerSecond)]
        public double Vy { get; set; }

        /// <summary>Velocity along the frame's Z (up) axis, m/s, relative to the centre body.</summary>
        [SitrepUnit(Units.MetresPerSecond)]
        public double Vz { get; set; }
    }
}
