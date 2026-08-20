namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads the provenance settings off the producer's main window and frame
    /// selector, by field reads only.
    ///
    /// <para><b>Every member here is a field or a property over a field, and that is
    /// not incidental.</b> The frame selector offers four parameterless members that
    /// would each hand over a formatted frame name, and every one of them reaches
    /// the producer's fatal-log helper through a default branch, which aborts the
    /// process. So the frame is read as its kind plus its centre body and the label
    /// is built on our side. See <see cref="ReflectedMembers"/> for the rule and
    /// <c>docs/creating-an-uplink.md</c> for the author-facing version.</para>
    ///
    /// <para>The prediction tolerance and step limit are deliberately NOT read here.
    /// They are recomputed by the producer's settings UI on every repaint from a
    /// per-vessel source we may not query, so a read from this class would return
    /// the constructor defaults dressed as the operator's choice. They arrive
    /// through <see cref="PredictionSettingsHook"/> instead.</para>
    /// </summary>
    public sealed class ProvenanceReflection
    {
        private const string DisplayPatchedConicsMember = "display_patched_conics";
        private const string HistoryLengthMember = "history_length";
        private const string FramesHidingMarkersMember = "frames_that_hide_unpinned_markers";
        private const string FramesHidingCelestialsMember = "frames_that_hide_unpinned_celestials";

        private const string FrameTypeMember = "frame_type";
        private const string SelectedCelestialMember = "selected_celestial";
        private const string TargetFrameSelectedMember = "target_frame_selected";
        private const string BodyNameMember = "bodyName";

        private readonly ReflectedMembers _m = new ReflectedMembers();

        /// <summary>
        /// The cold-readable half of the provenance.
        ///
        /// <para>Either argument may be null and each contributes independently: a
        /// build that moved the frame selector should cost the frame fields, not the
        /// whole surface. Every field is left null rather than defaulted, so a value
        /// that could not be read is reported as unknown instead of as a
        /// setting.</para>
        /// </summary>
        public ProvenanceObservation Read(object? mainWindow, object? frameSelector)
        {
            var observation = new ProvenanceObservation();
            if (mainWindow != null)
            {
                observation.DisplayPatchedConics = _m.ReadBool(mainWindow, DisplayPatchedConicsMember);
                observation.HistoryLengthSeconds = _m.ReadDouble(mainWindow, HistoryLengthMember);
                observation.FramesHidingUnpinnedMarkers = _m.ReadCount(mainWindow, FramesHidingMarkersMember);
                observation.FramesHidingUnpinnedCelestials = _m.ReadCount(mainWindow, FramesHidingCelestialsMember);
            }
            if (frameSelector != null)
            {
                observation.PlottingFrameType = FrameTypeOrdinal(_m.Value(frameSelector, FrameTypeMember));
                observation.TargetFrameSelected = _m.ReadBool(frameSelector, TargetFrameSelectedMember);
                observation.PlottingFrameCentreBody = CentreBodyName(_m.Value(frameSelector, SelectedCelestialMember));
            }
            return observation;
        }

        /// <summary>
        /// The frame kind as its ordinal.
        ///
        /// <para>An enum boxes as its own type, so it is converted rather than cast:
        /// the producer's enum type is not one we reference, and its ordinal is the
        /// whole of what we want to carry. Naming the kind is the client's job,
        /// because the producer's own namers abort.</para>
        /// </summary>
        private static int? FrameTypeOrdinal(object? frameType)
        {
            if (frameType == null || !frameType.GetType().IsEnum)
            {
                return frameType as int?;
            }
            try
            {
                return System.Convert.ToInt32(frameType);
            }
            catch (System.Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The centre body's name, read off the game's own body object.
        ///
        /// <para><c>bodyName</c> rather than <c>name</c>, and the reason is about
        /// reflection rather than about meaning: the two agree (KSP's <c>name</c> is
        /// a <c>new</c> property returning <c>bodyName</c>), but precisely because it
        /// SHADOWS Unity's own <c>Object.name</c>, a by-name member walk up the base
        /// chain can bind either one. The plain field is unambiguous. Read by
        /// reflection like the rest, so this class needs no game type at compile
        /// time.</para>
        /// </summary>
        private string? CentreBodyName(object? celestial)
        {
            if (celestial == null)
            {
                return null;
            }
            var name = _m.ReadString(celestial, BodyNameMember);
            return string.IsNullOrEmpty(name) ? null : name;
        }
    }
}
