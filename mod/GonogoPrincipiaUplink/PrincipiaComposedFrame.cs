namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Which frame a burn composed here should be expressed in, taken from the
    /// frame the operator is looking at.
    ///
    /// <para><b>The producer's own rule, not one invented here.</b> When its
    /// planner opens a new burn it seeds the burn's frame from the plotting frame,
    /// and where the plotting frame is one a burn cannot carry it falls back to the
    /// direction frame on the same pair of bodies. Following that means a burn's
    /// three components mean on arrival what they meant on the screen they were
    /// composed against; seeding a frame of our own choosing would leave the
    /// operator reading a tangent that is not the tangent they aimed.</para>
    ///
    /// <para><b>Which body lands in which slot is decided per kind, because the
    /// producer decides it per kind.</b> The centred kinds name one body and use
    /// the centre slot. The direction kinds name the pair with the SELECTED body
    /// first, which is the producer's deliberate inversion: the body it wants held
    /// fixed is the one the selector sits on, and the frame it builds calls the held
    /// body the primary. The pulsating kind names the same pair the other way
    /// round, and its fallback resolves to the same descriptor the direction kinds
    /// produce, so all three non-centred kinds land on one rule here.</para>
    /// </summary>
    internal static class PrincipiaComposedFrame
    {
        internal const int BodyCentredNonRotating = 6000;
        internal const int BodySurface = 6003;

        /// <summary>
        /// The descriptor a composed burn should carry, or false with the reason.
        /// </summary>
        internal static bool TryResolve(
            FrameObservation? plotting,
            out int extension,
            out int centre,
            out int primary,
            out int secondary,
            out string? refusal)
        {
            extension = 0;
            centre = PrincipiaBurnStruct.NoBody;
            primary = PrincipiaBurnStruct.NoBody;
            secondary = PrincipiaBurnStruct.NoBody;

            if (plotting?.Type == null)
            {
                refusal =
                    "The frame the game's navigation view is in has not been read, so there is "
                    + "no frame to compose a burn in. A burn's components mean nothing without "
                    + "one.";
                return false;
            }
            if (plotting.TargetFrameSelected == true)
            {
                // A target frame is defined against a VESSEL and carries no kind at
                // all, so there is no descriptor to seed a burn from. The producer's
                // own planner has the same gap.
                refusal =
                    "The navigation view is in a frame defined against a target vessel, which "
                    + "is not a frame a burn can be expressed in. Choose a body-centred frame "
                    + "to compose the first burn in.";
                return false;
            }
            if (plotting.SelectedBodyIndex == null)
            {
                refusal =
                    "The body the navigation view's frame is built on could not be read, and a "
                    + "frame cannot be built on a body nobody named.";
                return false;
            }

            if (plotting.Type == BodyCentredNonRotating || plotting.Type == BodySurface)
            {
                extension = plotting.Type.Value;
                centre = plotting.SelectedBodyIndex.Value;
                refusal = null;
                return true;
            }

            if (plotting.ParentBodyIndex == null)
            {
                refusal =
                    "This frame turns about a pair of bodies and only one of them could be "
                    + "read, so the pair is incomplete.";
                return false;
            }

            extension = PrincipiaControlFrameSource.BodyCentredParentDirection;
            primary = plotting.SelectedBodyIndex.Value;
            secondary = plotting.ParentBodyIndex.Value;
            refusal = null;
            return true;
        }
    }
}
