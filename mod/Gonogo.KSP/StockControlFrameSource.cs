using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The always-present VANILLA control-frame source: what frame the game's
    /// navigation view is in when nothing else owns it.
    ///
    /// <para>Stock has exactly one kind of frame and it is a real one, not a
    /// placeholder. The map view is centred on a body with axes fixed against the
    /// stars, which is <see cref="ControlFrameKind.BodyCentredInertial"/>, and
    /// every conic KSP draws is drawn in it. An n-body producer elected over this
    /// one reports one of the other kinds through the same interface, and nothing
    /// downstream learns which mod answered.</para>
    ///
    /// <para>The centre is the active vessel's reference body rather than whatever
    /// the map camera is pointed at. The camera's focus is a fact about where the
    /// player scrolled to; the reference body is the frame the craft's own
    /// elements are expressed in, which is what a frame-aware reader is asking
    /// about.</para>
    ///
    /// <para><b>Callable off the main thread</b>, so every read below is a plain
    /// managed field on a game object and never a native accessor. This is
    /// sampled inside a channel mapper, and those run on the Courier thread:
    /// <c>UnityEngine.Object.name</c> in particular is a native call a non-Unity
    /// thread may not make, which is why the body travels as <c>bodyName</c>, the
    /// same key <c>system.bodies</c> uses.</para>
    /// </summary>
    internal sealed class StockControlFrameSource : IControlFrameSource
    {
        public string ProviderId => "stock-map-view";

        public ControlFrame? Frame
        {
            get
            {
                var vessel = ActiveVesselScope.Current;
                var body = vessel?.orbit?.referenceBody;
                if (body == null || string.IsNullOrEmpty(body.bodyName))
                {
                    // No craft, or no orbit yet. Null rather than a frame centred
                    // on a guess: a substituted centre draws a trajectory that
                    // looks exactly like one drawn in the right frame.
                    return null;
                }

                return new ControlFrame
                {
                    Kind = ControlFrameKind.BodyCentredInertial,
                    CentreBody = body.bodyName,
                    // Stock has no target frame. False rather than null, because
                    // this is a confirmed answer about stock and not an absence.
                    TargetFrameSelected = false,
                };
            }
        }

        /// <summary>
        /// Stock cannot be put in a frame. Its view frame is the active craft's
        /// reference body, which changes when the craft changes sphere of
        /// influence and at no other time, so there is nothing here to set.
        ///
        /// <para>Refused rather than silently accepted, because a command that
        /// reports success and moves nothing leaves an operator believing the view
        /// is somewhere it is not, and the next thing they read off it will be
        /// read in the wrong frame.</para>
        /// </summary>
        public CommandResult SetFrame(SetControlFrameArgs frame) =>
            CommandResult.Fail(
                CommandErrorCode.ModeUnavailable,
                "Stock's view frame follows the active craft's reference body and "
                    + "cannot be set. An n-body producer offers selectable frames.");
    }
}
