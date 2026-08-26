using System;
using Sitrep.Contract;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// What frame the producer has the game's navigation view in, answered as the
    /// generalised <see cref="ControlFrame"/> rather than as a producer-shaped
    /// payload.
    ///
    /// <para><b>Why this exists at all.</b> Carried only inside this Uplink's own
    /// settings channel, as the producer's own enum ordinal, the frame would be a
    /// fact every frame-aware reader needs that is available solely when one
    /// specific mod is installed, and readable only by something that knows that
    /// mod's numbering. Registered as a source for the
    /// <c>controlFrame</c> capability, it answers the same channel stock answers,
    /// and nothing downstream learns which of the two replied.</para>
    ///
    /// <para><b>The ordinals are stated once and taken from the producer's own
    /// enum.</b> An earlier table of these was keyed 0 to 4 in an order matching
    /// neither the declaration nor the numbering, so every real frame fell through
    /// to the unknown branch, and the test asserted the same invented keys the
    /// table was built from: both were wrong together and agreed. The numbers
    /// below are the producer's, and an ordinal that is not one of them reads as
    /// <see cref="ControlFrameKind.Unspecified"/> rather than as a guess.</para>
    /// </summary>
    internal sealed class PrincipiaControlFrameSource : IControlFrameSource
    {
        internal const int BodyCentredNonRotating = 6000;
        internal const int BarycentricRotating = 6001;
        internal const int BodyCentredParentDirection = 6002;
        internal const int BodySurface = 6003;
        internal const int RotatingPulsating = 6004;

        private readonly Func<SettingsObservation?> _observation;

        internal PrincipiaControlFrameSource(Func<SettingsObservation?> observation)
        {
            _observation = observation ?? throw new ArgumentNullException(nameof(observation));
        }

        public string ProviderId => "principia";

        public ControlFrame? Frame => Map(_observation()?.PlottingFrame);

        /// <summary>
        /// Not yet. The producer's plotting frame is settable, but the call is a
        /// write on state the player's own UI reads, and it sits among calls this
        /// Uplink already refuses by name for aborting the process three frames
        /// later on exactly that state. Shipping it unverified would put a crash in
        /// somebody's game to save a rig session.
        ///
        /// <para>Refused with the reason rather than left unimplemented, so a
        /// command centre is told the view cannot be moved rather than watching a
        /// command succeed and nothing happen.</para>
        /// </summary>
        public CommandResult SetFrame(SetControlFrameArgs frame) =>
            CommandResult.Fail(
                CommandErrorCode.ModeUnavailable,
                "Moving the producer's plotting frame is not wired up: the call writes "
                    + "state the player's own interface reads, and has not been proved "
                    + "safe against a running game.");

        /// <summary>
        /// The observed frame as the generalised shape, or null when nothing has
        /// been observed. Null rather than an empty frame, because a frame with no
        /// kind reads as an answer to anything that only checks for a value.
        /// </summary>
        internal static ControlFrame? Map(FrameObservation? observed)
        {
            if (observed == null)
            {
                return null;
            }

            var frame = new ControlFrame
            {
                Kind = KindOf(observed.Type),
                CentreBody = observed.CentreBody,
                PrimaryBody = observed.PrimaryBody,
                SecondaryBody = observed.SecondaryBody,
                TargetFrameSelected = observed.TargetFrameSelected,
                TargetId = observed.TargetVesselId,
            };

            // Empty means "the head is the whole of it" rather than "not read", so
            // an empty side travels as absent rather than as an empty list a reader
            // would have to know to treat as the head.
            if (observed.PrimaryBodies.Count > 0)
            {
                frame.PrimaryBodies = observed.PrimaryBodies.ToArray();
            }
            if (observed.SecondaryBodies.Count > 0)
            {
                frame.SecondaryBodies = observed.SecondaryBodies.ToArray();
            }

            return frame;
        }

        internal static ControlFrameKind KindOf(int? ordinal)
        {
            switch (ordinal)
            {
                case BodyCentredNonRotating: return ControlFrameKind.BodyCentredInertial;
                case BarycentricRotating: return ControlFrameKind.BarycentricRotating;
                case BodyCentredParentDirection: return ControlFrameKind.BodyCentredBodyDirection;
                case BodySurface: return ControlFrameKind.BodySurface;
                case RotatingPulsating: return ControlFrameKind.RotatingPulsating;
                // Includes the target frame, whose selector carries no kind at all
                // because it sits orthogonally to the enum: TargetFrameSelected is
                // what says so, and inventing a kind for it here would put a frame
                // on the wire the producer does not have.
                default: return ControlFrameKind.Unspecified;
            }
        }
    }
}
