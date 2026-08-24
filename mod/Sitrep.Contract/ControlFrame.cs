#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
namespace Sitrep.Contract
{
    /// <summary>
    /// The kinds of reference frame a control frame can be.
    ///
    /// <para>Taken from what an n-body producer actually offers rather than from
    /// what this app would find convenient: the five members below are the five
    /// frame types the shipped native build constructs. A vocabulary invented
    /// here would name frames nothing can select, and would have no name for
    /// frames a player is looking at right now.</para>
    ///
    /// <para><b>A superset of what a widget can FOLLOW.</b> The read frames a
    /// widget may draw in cover three of these. A control frame outside that
    /// subset is a real state and not an error: a widget set to follow the
    /// control frame resolves to nothing, which is the behaviour that side
    /// already documents.</para>
    /// </summary>
    public enum ControlFrameKind
    {
        /// <summary>Nothing stated one. Distinct from a frame we could not name.</summary>
        Unspecified = 0,

        /// <summary>Centred on a body, axes fixed against the stars.</summary>
        BodyCentredInertial = 1,

        /// <summary>
        /// Centred on a body, one axis held towards another body. What "parent
        /// direction" names on the read side.
        /// </summary>
        BodyCentredBodyDirection = 2,

        /// <summary>Turning with the barycentre of two bodies.</summary>
        BarycentricRotating = 3,

        /// <summary>
        /// Turning with a pair of bodies AND holding the separation of their two
        /// mass centres fixed, so a transfer between them draws the same shape
        /// whatever their current distance.
        /// </summary>
        RotatingPulsating = 4,

        /// <summary>Centred on a body and turning with its surface.</summary>
        BodySurface = 5,
    }

    /// <summary>
    /// The frame the game's own navigation view is expressed in: what the player
    /// is looking at, and what a burn expressed relative to the control frame is
    /// held fixed against.
    ///
    /// <para><b>Why this is not a widget's choice.</b> A widget picks a read
    /// frame for itself and nothing else sees it. This is the game's, it is one
    /// at a time, and it is written as well as read, so a command centre can put
    /// the player's view where a plan is being discussed.</para>
    ///
    /// <para><b>Bodies travel by name.</b> Every other body table in this mod is
    /// keyed by <c>bodyName</c>, <c>system.bodies</c> included, so a frame named
    /// the same way needs no join to be understood and cannot disagree with the
    /// table beside it.</para>
    ///
    /// <para><b>The pulsating frames carry SETS, not just a pair.</b> A rotating
    /// frame turns about two bodies; a pulsating one turns about two groups, and
    /// the origin is defined by the mass of the whole group. Publishing only the
    /// head of each side loses bodies out of the mass that decides where the
    /// origin is, and loses them silently, because the head is the name a reader
    /// recognises. <see cref="PrimaryBodies"/> always leads with
    /// <see cref="PrimaryBody"/> so a reader wanting the pair can take the heads
    /// and a reader computing the frame can take the sets.</para>
    /// </summary>
    [SitrepTopic("system.frame")]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public sealed class ControlFrame
    {
        [SitrepUnit(Units.Enumeration)]
        public ControlFrameKind Kind { get; set; }

        /// <summary>
        /// The body the frame is centred on, when it has one. The rotating frames
        /// are defined by their pair rather than by a centre.
        /// </summary>
        [SitrepUnit(Units.Text)]
        public string? CentreBody { get; set; }

        /// <summary>The body a rotating frame turns about. Null for the centred frames.</summary>
        [SitrepUnit(Units.Text)]
        public string? PrimaryBody { get; set; }

        /// <summary>The body a rotating frame is anchored to. Null for the centred frames.</summary>
        [SitrepUnit(Units.Text)]
        public string? SecondaryBody { get; set; }

        /// <summary>
        /// Every body on the primary side, leading with <see cref="PrimaryBody"/>.
        /// See this type's own doc for why the set travels rather than the head.
        /// </summary>
        [SitrepUnit(Units.Text)]
        public string[]? PrimaryBodies { get; set; }

        /// <summary>Every body on the secondary side, leading with <see cref="SecondaryBody"/>.</summary>
        [SitrepUnit(Units.Text)]
        public string[]? SecondaryBodies { get; set; }

        /// <summary>
        /// The frame is defined against the current target rather than against a
        /// body, which sits orthogonally to <see cref="Kind"/> rather than inside
        /// it. Closest approach is computed only in this frame, and apsides do not
        /// exist in it at all.
        /// </summary>
        [SitrepUnit(Units.Flag)]
        public bool? TargetFrameSelected { get; set; }

        /// <summary>The target the frame is defined against, when it is a target frame.</summary>
        [SitrepUnit(Units.Id)]
        public string? TargetId { get; set; }
    }

    /// <summary>
    /// Whatever knows what frame the game's navigation view is currently in.
    ///
    /// <para>A capability rather than a method on core, because the answer belongs
    /// to whichever mod owns the view. Stock's answer is real and simple, a body
    /// and inertial axes; an n-body producer's is one of five kinds over sets of
    /// bodies. Core resolves the interface and never learns which is installed,
    /// which is the whole of what makes this side stock-shaped rather than
    /// producer-shaped.</para>
    ///
    /// <para><see cref="Frame"/> is null when nothing could be read. That is not a
    /// gap to fill with a default: a substituted frame draws a trajectory that
    /// looks exactly like one drawn in the frame the player is actually in, and
    /// nothing downstream could tell them apart.</para>
    /// </summary>
    public interface IControlFrameSource : ISitrepProvider
    {
        ControlFrame? Frame { get; }
    }

    /// <summary>
    /// The capability id an <see cref="IControlFrameSource"/> competes for.
    ///
    /// <para>Declared here rather than at the election for the same reason
    /// <see cref="GravityModelCapability"/> is: an Uplink cannot compile against
    /// core, so a literal at the election would be a copy free to disagree with
    /// the one an Uplink writes, and a disagreement shows only as a frame that
    /// never arrives.</para>
    /// </summary>
    public static class ControlFrameCapability
    {
        public const string Id = "controlFrame";
    }
}
