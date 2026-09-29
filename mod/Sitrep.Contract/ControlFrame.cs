#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
namespace Sitrep.Contract
{
    /// <summary>
    /// The kinds of reference frame a control frame can be: the five frame types
    /// an n-body producer constructs, plus <see cref="Unspecified"/>.
    ///
    /// <para>This is a superset of the frames a widget can draw in, which cover
    /// three of these. A control frame outside that subset is a real state, not
    /// an error: a widget set to follow the control frame then resolves to
    /// nothing.</para>
    /// </summary>
    /// <category>Vessel</category>
    [SitrepContract]
    public enum ControlFrameKind
    {
        /// <summary>No kind was stated, including for the target frame (see <see cref="ControlFrame.TargetFrameSelected"/>).</summary>
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
    /// <para>This is not a widget's own read frame, which nothing else sees. It
    /// belongs to the game, there is one at a time, and it can be written as
    /// well as read (<see cref="SetControlFrameArgs"/>), so a command centre can
    /// put the player's view where a plan is being discussed.</para>
    ///
    /// <para>Bodies are named by <c>bodyName</c>, the key of every other body
    /// table on the wire, <c>system.bodies</c> included.</para>
    ///
    /// <para>A pulsating frame turns about two groups of bodies, and its origin
    /// is defined by the mass of each whole group, so the sets travel as well as
    /// the pair. <see cref="PrimaryBodies"/> always leads with
    /// <see cref="PrimaryBody"/>: take the heads for the pair, or the sets to
    /// compute the frame.</para>
    ///
    /// <para>The whole payload is <c>null</c> when the frame could not be read.
    /// With stock KSP the frame is always <see cref="ControlFrameKind.BodyCentredInertial"/>
    /// about the active vessel's reference body.</para>
    /// </summary>
    /// <category>Vessel</category>
    [SitrepContract]
    [SitrepTopic("system.frame")]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public sealed class ControlFrame
    {
        /// <summary>The kind of frame. <see cref="ControlFrameKind.Unspecified"/> for the target frame, which has no kind.</summary>
        [SitrepUnit(Units.Enumeration)]
        public ControlFrameKind Kind { get; set; }

        /// <summary>
        /// The <c>bodyName</c> the frame is centred on, or <c>null</c> when it has
        /// none. The rotating frames are defined by their pair rather than by a
        /// centre.
        /// </summary>
        [SitrepUnit(Units.Text)]
        public string? CentreBody { get; set; }

        /// <summary>The <c>bodyName</c> a rotating frame turns about. <c>null</c> for the centred frames.</summary>
        [SitrepUnit(Units.Text)]
        public string? PrimaryBody { get; set; }

        /// <summary>The <c>bodyName</c> a rotating frame is anchored to. <c>null</c> for the centred frames.</summary>
        [SitrepUnit(Units.Text)]
        public string? SecondaryBody { get; set; }

        /// <summary>
        /// Every body on the primary side, by <c>bodyName</c>, leading with
        /// <see cref="PrimaryBody"/>. <c>null</c> when the head is the whole side,
        /// never an empty array.
        /// </summary>
        [SitrepUnit(Units.Text)]
        public string[]? PrimaryBodies { get; set; }

        /// <summary>
        /// Every body on the secondary side, by <c>bodyName</c>, leading with
        /// <see cref="SecondaryBody"/>. <c>null</c> when the head is the whole
        /// side, never an empty array.
        /// </summary>
        [SitrepUnit(Units.Text)]
        public string[]? SecondaryBodies { get; set; }

        /// <summary>
        /// <c>true</c> when the frame is defined against the current target rather
        /// than against a body. This sits beside <see cref="Kind"/> rather than
        /// inside it. Closest approach is computed only in this frame, and apsides
        /// do not exist in it. <c>null</c> when the source did not say.
        /// </summary>
        [SitrepUnit(Units.Flag)]
        public bool? TargetFrameSelected { get; set; }

        /// <summary>The id of the target vessel the frame is defined against, when it is a target frame; otherwise <c>null</c>.</summary>
        [SitrepUnit(Units.Id)]
        public string? TargetId { get; set; }
    }

    /// <summary>
    /// <c>system.frame.set</c>'s args: the frame to put the view in.
    ///
    /// <para>A caller names the pair, not the sets. Unlike
    /// <see cref="ControlFrame"/>, which reports <c>PrimaryBodies</c> and
    /// <c>SecondaryBodies</c>, this carries only the two heads: the producer
    /// decides which bodies fall on each side of a pulsating frame from its own
    /// body tree.</para>
    ///
    /// <para>Refusal is normal: stock KSP's frame follows the active vessel's
    /// reference body and cannot be set, so the command fails with
    /// <c>ModeUnavailable</c>.</para>
    /// </summary>
    /// <category>Command arguments</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    [SitrepCommand("system.frame.set", Delay = DelayRole.TrueNow)]
    public class SetControlFrameArgs
    {
        /// <summary>The kind of frame to select.</summary>
        [SitrepUnit(Units.Enumeration)]
        public ControlFrameKind Kind { get; set; }

        /// <summary>The <c>bodyName</c> to centre on. Required for the centred frames.</summary>
        [SitrepUnit(Units.Text)]
        public string? CentreBody { get; set; }

        /// <summary>The <c>bodyName</c> a rotating frame turns about. Required for the rotating frames.</summary>
        [SitrepUnit(Units.Text)]
        public string? PrimaryBody { get; set; }

        /// <summary>The <c>bodyName</c> a rotating frame is anchored to. Required for the rotating frames.</summary>
        [SitrepUnit(Units.Text)]
        public string? SecondaryBody { get; set; }

        /// <summary>
        /// <c>true</c> to ask for the target frame, which sits beside
        /// <see cref="Kind"/> rather than inside it.
        /// </summary>
        [SitrepUnit(Units.Flag)]
        public bool? TargetFrameSelected { get; set; }
    }

    /// <summary>
    /// The provider that knows which frame the game's navigation view is in, and
    /// can move it. It competes for <see cref="ControlFrameCapability.Id"/>.
    ///
    /// <para>It is a capability because the frame belongs to whichever mod owns
    /// the view. Stock's is a body with inertial axes; an n-body producer's is
    /// one of five kinds over sets of bodies.</para>
    /// </summary>
    /// <category>Uplink API</category>
    public interface IControlFrameSource : ISitrepProvider
    {
        /// <summary>
        /// The frame the navigation view is in right now, or <c>null</c> when
        /// nothing could be read.
        ///
        /// <para>Do not substitute a default for <c>null</c>: a trajectory drawn in
        /// a substituted frame looks exactly like one drawn in the frame the player
        /// is actually in.</para>
        /// </summary>
        ControlFrame? Frame { get; }

        /// <summary>
        /// Puts the view in <paramref name="frame"/>.
        ///
        /// <para>Read and write share one interface because the owner of the view
        /// is the only thing that can move it.</para>
        ///
        /// <para>Refusing is a normal outcome, not a fault: stock's frame follows
        /// the craft's own reference body and cannot be set at all. A source that
        /// cannot honour a frame returns a failure rather than succeeding and
        /// leaving the view where it was.</para>
        /// </summary>
        /// <param name="frame">The frame to select.</param>
        /// <returns>Success once the view is in the frame, or a failure saying why it could not be.</returns>
        CommandResult SetFrame(SetControlFrameArgs frame);
    }

    /// <summary>
    /// The capability id an <see cref="IControlFrameSource"/> competes for.
    /// Register against this constant rather than a literal: a mismatch shows
    /// only as a frame that never arrives.
    /// </summary>
    /// <category>Uplink API</category>
    public static class ControlFrameCapability
    {
        /// <summary>The capability id, <c>"controlFrame"</c>.</summary>
        public const string Id = "controlFrame";
    }
}
