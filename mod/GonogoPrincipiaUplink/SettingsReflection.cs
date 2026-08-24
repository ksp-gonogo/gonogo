using System.Collections;
using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads the settings that live on the producer's own window objects, by field
    /// reads and audited property reads and nothing else.
    ///
    /// <para><b>Not one plugin call happens here</b>, and that is what makes this
    /// half safe to run every tick regardless of scene, vessel or plugin state.
    /// The settings that DO come from the plugin (the per-vessel prediction bound
    /// and the per-plan integrator bound) are read through the precondition
    /// protocol instead, in <see cref="NativeSettingsReader"/>.</para>
    ///
    /// <para>Each of the four objects contributes independently and any of them may
    /// be null: a build that moved the orbit analyser should cost the analyser's
    /// six settings, not the whole reading. Every value is left null rather than
    /// defaulted, because a setting reported from a failed read is worse than a
    /// missing one, and on this surface the defaults are all plausible.</para>
    /// </summary>
    public sealed class SettingsReflection
    {
        private const string DisplayPatchedConicsMember = "display_patched_conics";
        private const string HistoryLengthMember = "history_length";
        private const string FramesHidingMarkersMember = "frames_that_hide_unpinned_markers";
        private const string FramesHidingCelestialsMember = "frames_that_hide_unpinned_celestials";
        private const string SelectingTargetVesselMember = "selecting_active_vessel_target";
        private const string SelectingTargetCelestialMember = "selecting_target_celestial_";
        private const string VerboseLoggingMember = "verbose_logging_";
        private const string SuppressedLoggingMember = "suppressed_logging_";
        private const string StderrLoggingMember = "stderr_logging_";
        private const string BufferedLoggingMember = "buffered_logging_";
        private const string MustRecordJournalMember = "must_record_journal_";
        private const string JournalingMember = "journaling_";

        private const string FrameTypeMember = "frame_type";
        private const string SelectedCelestialMember = "selected_celestial";
        private const string TargetFrameSelectedMember = "target_frame_selected";
        private const string FrameTargetMember = "target";
        private const string PinnedMember = "pinned";
        private const string TargetPinnedMember = "target_pinned_";

        private const string OptimisationAltitudeMember = "optimization_altitude_";
        private const string OptimisationInclinationMember = "optimization_inclination_in_degrees_";
        private const string ShowGuidanceMember = "show_guidance_";

        private const string MissionDurationMember = "mission_duration_";
        private const string AutodetectRecurrenceMember = "autodetect_recurrence_";
        private const string RevolutionsPerCycleMember = "revolutions_per_cycle_";
        private const string DaysPerCycleMember = "days_per_cycle_";
        private const string GroundTrackRevolutionMember = "ground_track_revolution_";
        private const string ShowGraphsMember = "show_graphs_";
        private const string MaxEMinILinesMember = "show_max_e_min_i_lines_";
        private const string MinEMaxILinesMember = "show_min_e_max_i_lines_";

        private const string SliderValueMember = "value";
        private const string BodyNameMember = "bodyName";
        private const string BodyIndexMember = "flightGlobalsIndex";
        private const string ReferenceBodyMember = "referenceBody";
        private const string OrbitingBodiesMember = "orbitingBodies";
        private const string VesselIdMember = "id";
        private const string VesselNameMember = "vesselName";

        private const string FrameExtensionMember = "extension";
        private const string FrameCentreIndexMember = "centre_index";
        private const string FramePrimaryIndexMember = "primary_index";
        private const string FrameSecondaryIndexMember = "secondary_index";

        /// <summary>The producer's own frame kinds, by the values it declares. Two
        /// of them build their key from the centre body alone; the other three from
        /// the pair of bodies, with the centre left unset.</summary>
        private const int BodyCentredNonRotating = 6000;
        private const int BodySurface = 6003;
        private const int RotatingPulsating = 6004;

        /// <summary>The producer's "no body" in an index slot.</summary>
        private const int NoBody = -1;

        /// <summary>How far down a body tree the set walk will go. The deepest real
        /// chain is star, planet, moon, submoon, so this is well clear of it and
        /// still bounds a cycle in a graph we do not own.</summary>
        private const int MaxSystemDepth = 8;

        private readonly ReflectedMembers _m = new ReflectedMembers();

        public void Read(ISettingsSource source, SettingsObservation into)
        {
            ReadMainWindow(source.MainWindow, into);
            ReadFrameSelector(source.FrameSelector, into);
            ReadFlightPlanner(source.FlightPlanner, into);
            ReadOrbitAnalyser(source.OrbitAnalyser, into);
            ReadDeclutter(source.MainWindow, source.FrameSelector, into);
        }

        private void ReadMainWindow(object? window, SettingsObservation into)
        {
            if (window == null)
            {
                return;
            }
            into.DisplayPatchedConics = _m.ReadBool(window, DisplayPatchedConicsMember);
            into.HistoryLengthSeconds = _m.ReadDouble(window, HistoryLengthMember);
            into.FramesHidingUnpinnedMarkers = _m.ReadCount(window, FramesHidingMarkersMember);
            into.FramesHidingUnpinnedCelestials = _m.ReadCount(window, FramesHidingCelestialsMember);
            into.SelectingTargetVessel = _m.ReadBool(window, SelectingTargetVesselMember);
            into.SelectingTargetCelestial = _m.ReadBool(window, SelectingTargetCelestialMember);

            into.VerboseLevel = _m.ReadInt(window, VerboseLoggingMember);
            into.LogThreshold = _m.ReadInt(window, SuppressedLoggingMember);
            into.StderrThreshold = _m.ReadInt(window, StderrLoggingMember);
            into.FlushThreshold = _m.ReadInt(window, BufferedLoggingMember);
            into.RecordJournalRequested = _m.ReadBool(window, MustRecordJournalMember);
            into.Journaling = _m.ReadBool(window, JournalingMember);
        }

        /// <summary>
        /// The plotting frame, its pinned exemptions, and the target vessel.
        ///
        /// <para>The frame's identity is assembled from plain fields rather than
        /// asked for. The producer offers a method that returns exactly this, and
        /// it throws a fatal log for any kind it does not expect, which aborts the
        /// process rather than raising.</para>
        /// </summary>
        private void ReadFrameSelector(object? selector, SettingsObservation into)
        {
            if (selector == null)
            {
                return;
            }
            var targetFrame = _m.ReadBool(selector, TargetFrameSelectedMember);
            var centre = _m.Value(selector, SelectedCelestialMember);
            var target = _m.Value(selector, FrameTargetMember);

            var frame = new FrameObservation
            {
                Selector = "plotting",
                Type = EnumOrdinal(_m.Value(selector, FrameTypeMember)),
                TargetFrameSelected = targetFrame,
                TargetVesselId = target == null ? null : _m.Value(target, VesselIdMember)?.ToString(),
                TargetVesselName = target == null ? null : _m.ReadString(target, VesselNameMember),
            };
            NameFrameBodies(centre, frame);
            into.PlottingFrame = frame;

            // The target the frame is defined against IS the game's target vessel:
            // the producer sets both from the same event, and reading it here keeps
            // this class free of the game's own globals.
            into.TargetVesselId = frame.TargetVesselId;
            into.TargetVesselName = frame.TargetVesselName;

            into.TargetPinned = _m.ReadBool(selector, TargetPinnedMember);
            ReadPinned(_m.Value(selector, PinnedMember), into);
        }

        /// <summary>
        /// The bodies a frame is named with, taken from the one body the selector
        /// holds.
        ///
        /// <para>The centred frames are named by that body alone. The three
        /// rotating kinds are named by it and its parent, in that order, which is
        /// the same pair the producer passes to its own format strings.</para>
        ///
        /// <para>A pulsating frame additionally turns about a pair of SETS, and
        /// those are filled here too. Everything else on this class reads a value
        /// the producer already computed; this one is the exception, because the
        /// sets exist only inside the producer's own iterator and the method that
        /// would return them is on the refusal list.</para>
        /// </summary>
        private void NameFrameBodies(object? centre, FrameObservation frame)
        {
            if (centre == null)
            {
                return;
            }
            var name = BodyName(centre);
            frame.SelectedBodyIndex = _m.ReadInt(centre, BodyIndexMember);
            if (frame.Type == BodyCentredNonRotating || frame.Type == BodySurface)
            {
                frame.CentreBody = name;
                return;
            }
            frame.SecondaryBody = name;
            var parent = _m.Value(centre, ReferenceBodyMember);
            frame.ParentBodyIndex = parent == null ? null : _m.ReadInt(parent, BodyIndexMember);
            frame.PrimaryBody = parent == null ? null : BodyName(parent);
            if (frame.Type != RotatingPulsating)
            {
                return;
            }
            CollectSystem(parent, centre, frame.PrimaryBodies);
            CollectSystem(centre, null, frame.SecondaryBodies);
            // A side that turned out to be one body is left as the singular field
            // alone, so an empty list reads the same way everywhere: the head is
            // the whole of it. An Earth-Moon frame's primary side really is Earth.
            if (frame.PrimaryBodies.Count < 2)
            {
                frame.PrimaryBodies.Clear();
            }
            if (frame.SecondaryBodies.Count < 2)
            {
                frame.SecondaryBodies.Clear();
            }
        }

        /// <summary>
        /// The producer's own body-set rule, replicated: a body, then each of its
        /// children's subtrees in the game's own order, stopping dead at
        /// <paramref name="end"/>.
        ///
        /// <para>The stop is what makes this worth writing out. A Sun-Earth
        /// pulsating frame's primary side is the Sun's system UP TO Earth, so it is
        /// Sun, Mercury and Venus, and Mars and everything beyond are excluded.
        /// That is order-dependent on a list the game owns, so replicating it
        /// literally is the only way to get the producer's frame rather than a
        /// plausible one.</para>
        ///
        /// <para>The stop is tested at each level rather than propagated out of the
        /// recursion, which is the producer's own behaviour: its iterator yields a
        /// break, and a break inside a nested iteration ends that iteration alone.
        /// It reaches the same answer here because the body a frame stops at is
        /// always a direct child of the body it starts from.</para>
        ///
        /// <para>Depth-bounded because the walk is over a third-party graph. A
        /// moon listed as its own parent's child would otherwise hang the reading
        /// thread, which in this Uplink is the game's main thread.</para>
        /// </summary>
        private void CollectSystem(object? centre, object? end, List<string> into)
        {
            CollectSystem(centre, end, into, 0);
        }

        private void CollectSystem(object? centre, object? end, List<string> into, int depth)
        {
            if (centre == null || depth > MaxSystemDepth)
            {
                return;
            }
            var name = BodyName(centre);
            if (name != null)
            {
                into.Add(name);
            }
            if (_m.Value(centre, OrbitingBodiesMember) is not IEnumerable children)
            {
                return;
            }
            foreach (var child in children)
            {
                if (child == null || ReferenceEquals(child, end))
                {
                    return;
                }
                CollectSystem(child, end, into, depth + 1);
            }
        }

        /// <summary>The bodies the operator pinned exempt, by name. A dictionary of
        /// body to flag, so only the true ones are the exemption list.</summary>
        private void ReadPinned(object? pinned, SettingsObservation into)
        {
            if (pinned is not IDictionary entries)
            {
                return;
            }
            foreach (DictionaryEntry entry in entries)
            {
                if (entry.Value is not true || entry.Key == null)
                {
                    continue;
                }
                var name = BodyName(entry.Key);
                if (name != null)
                {
                    into.PinnedCelestials.Add(name);
                }
            }
        }

        private void ReadFlightPlanner(object? planner, SettingsObservation into)
        {
            if (planner == null)
            {
                return;
            }
            into.OptimiserTargetAltitudeMetres = _m.ReadDouble(planner, OptimisationAltitudeMember);
            // Nullable on the far side, and it stays nullable here: null means
            // inclination is not an objective, which is a different instruction
            // from an equatorial one.
            into.OptimiserTargetInclinationDegrees =
                _m.ReadDouble(planner, OptimisationInclinationMember);
            into.ShowManoeuvreOnNavball = _m.ReadBool(planner, ShowGuidanceMember);
        }

        private void ReadOrbitAnalyser(object? analyser, SettingsObservation into)
        {
            if (analyser == null)
            {
                return;
            }
            var duration = _m.Value(analyser, MissionDurationMember);
            into.AnalysisMissionDurationRequestedSeconds =
                duration == null ? null : _m.ReadDouble(duration, SliderValueMember);
            into.RecurrenceAutodetect = _m.ReadBool(analyser, AutodetectRecurrenceMember);
            into.RecurrenceRevolutionsPerCycle = _m.ReadInt(analyser, RevolutionsPerCycleMember);
            into.RecurrenceDaysPerCycle = _m.ReadInt(analyser, DaysPerCycleMember);
            into.GroundTrackRevolution = _m.ReadInt(analyser, GroundTrackRevolutionMember);
            into.ShowElementGraphs = _m.ReadBool(analyser, ShowGraphsMember);
            into.StabilityGridMaxEccentricityMinInclination =
                _m.ReadBool(analyser, MaxEMinILinesMember);
            into.StabilityGridMinEccentricityMaxInclination =
                _m.ReadBool(analyser, MinEMaxILinesMember);
        }

        /// <summary>
        /// Whether markers and celestials are hidden IN THE FRAME NOW SELECTED,
        /// which is the operator-facing question the two counts cannot answer.
        ///
        /// <para><b>How the frame is matched without asking the producer to build
        /// its own key.</b> The two sets are keyed by a frame descriptor whose
        /// identity is four integers: the kind, the centre index, and the first
        /// primary and secondary indices. Those four are exactly what the
        /// descriptor's own hash is taken over, and each one is a plain field on
        /// it, so the entries are read rather than compared through an equality we
        /// would have to reach a fatal-logging method to obtain.</para>
        ///
        /// <para>Our side of the comparison is reconstructed from the selector's
        /// own two fields by the producer's rule, and the producer does not use ONE
        /// rule. The centred kinds key on the selected body with no primaries. The
        /// pulsating kind keys on the parent then the selected body. The direction
        /// kinds key on those two the other way round, which is the producer's own
        /// deliberate inversion: the body it wants held fixed is the selected one,
        /// and the frame it builds calls the held body the primary. For the
        /// rotating kinds the producer's arrays run longer than one entry, but
        /// every entry after the first is derived from the same body, so the first
        /// pair determines the whole descriptor and the quadruple is a complete key
        /// rather than a prefix of one.</para>
        /// </summary>
        private void ReadDeclutter(object? window, object? selector, SettingsObservation into)
        {
            if (window == null || selector == null || into.PlottingFrame?.Type == null)
            {
                return;
            }
            var centre = _m.Value(selector, SelectedCelestialMember);
            if (centre == null)
            {
                return;
            }
            var type = into.PlottingFrame.Type.Value;
            var centreIndex = _m.ReadInt(centre, BodyIndexMember);
            if (centreIndex == null)
            {
                return;
            }

            int keyCentre;
            int keyPrimary;
            int keySecondary;
            if (type == BodyCentredNonRotating || type == BodySurface)
            {
                keyCentre = centreIndex.Value;
                keyPrimary = NoBody;
                keySecondary = NoBody;
            }
            else
            {
                var parent = _m.Value(centre, ReferenceBodyMember);
                var parentIndex = parent == null ? null : _m.ReadInt(parent, BodyIndexMember);
                if (parentIndex == null)
                {
                    return;
                }
                // The producer leaves the centre unset on this branch, so its
                // descriptor carries the type's default rather than a body.
                keyCentre = 0;
                if (type == RotatingPulsating)
                {
                    keyPrimary = parentIndex.Value;
                    keySecondary = centreIndex.Value;
                }
                else
                {
                    keyPrimary = centreIndex.Value;
                    keySecondary = parentIndex.Value;
                }
            }

            into.UnpinnedMarkersHiddenHere = SetContainsFrame(
                _m.Value(window, FramesHidingMarkersMember), type, keyCentre, keyPrimary, keySecondary);
            into.UnpinnedCelestialsHiddenHere = SetContainsFrame(
                _m.Value(window, FramesHidingCelestialsMember), type, keyCentre, keyPrimary, keySecondary);
        }

        private bool? SetContainsFrame(
            object? set, int type, int centreIndex, int primaryIndex, int secondaryIndex)
        {
            if (set is not IEnumerable entries)
            {
                return null;
            }
            foreach (var entry in entries)
            {
                if (entry == null)
                {
                    continue;
                }
                if (EnumOrdinal(_m.Value(entry, FrameExtensionMember)) == type
                    && _m.ReadInt(entry, FrameCentreIndexMember) == centreIndex
                    && FirstIndex(entry, FramePrimaryIndexMember) == primaryIndex
                    && FirstIndex(entry, FrameSecondaryIndexMember) == secondaryIndex)
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// A frame descriptor's primary or secondary index, whichever shape it
        /// holds.
        ///
        /// <para>The plotting descriptor carries arrays and the manœuvring one
        /// carries a bare integer, for the same field name. Both use minus one for
        /// "no body", the arrays by being empty and the integer by holding it, so
        /// one accessor covers both and the two shapes compare against the same
        /// key.</para>
        /// </summary>
        private int FirstIndex(object entry, string member)
        {
            var all = AllIndices(entry, member);
            return all.Count == 0 ? NoBody : all[0];
        }

        /// <summary>
        /// Every index a frame descriptor's primary or secondary field holds, in the
        /// order it holds them.
        ///
        /// <para>The array shape is not a formality: a pulsating frame's side is a
        /// SET, and the entries past the first are the rest of the mass that decides
        /// where the frame's origin sits. Taking the head is what the reading did
        /// before, and it lost them without saying so.</para>
        ///
        /// <para>A non-integer entry ends the read rather than being skipped. A
        /// field that suddenly holds something else has changed shape, and half a
        /// set published as a whole one is the failure this list exists to
        /// remove.</para>
        /// </summary>
        private List<int> AllIndices(object entry, string member)
        {
            var found = new List<int>();
            var value = _m.Value(entry, member);
            if (value is int scalar)
            {
                found.Add(scalar);
                return found;
            }
            if (value is IEnumerable items)
            {
                foreach (var item in items)
                {
                    if (item is not int index)
                    {
                        break;
                    }
                    found.Add(index);
                }
            }
            return found;
        }

        /// <summary>
        /// The frame's index-named bodies, resolved through the game's body table.
        ///
        /// <para>Used for a burn's manœuvring frame, which arrives from the plugin
        /// as integers rather than as objects: the plotting selector holds the body
        /// itself, and a burn's descriptor holds only its place in the game's
        /// table.</para>
        /// </summary>
        public FrameObservation FrameFromIndices(
            object descriptor, ICelestialNames celestials, string selector)
        {
            var type = EnumOrdinal(_m.Value(descriptor, FrameExtensionMember));
            var frame = new FrameObservation { Selector = selector, Type = type };
            if (type == BodyCentredNonRotating || type == BodySurface)
            {
                var centre = _m.ReadInt(descriptor, FrameCentreIndexMember);
                frame.CentreBody = centre == null ? null : celestials.NameOf(centre.Value);
                return frame;
            }
            NameSide(
                AllIndices(descriptor, FramePrimaryIndexMember),
                celestials,
                frame.PrimaryBodies);
            NameSide(
                AllIndices(descriptor, FrameSecondaryIndexMember),
                celestials,
                frame.SecondaryBodies);
            frame.PrimaryBody = frame.PrimaryBodies.Count == 0 ? null : frame.PrimaryBodies[0];
            frame.SecondaryBody =
                frame.SecondaryBodies.Count == 0 ? null : frame.SecondaryBodies[0];
            if (frame.PrimaryBodies.Count < 2)
            {
                frame.PrimaryBodies.Clear();
            }
            if (frame.SecondaryBodies.Count < 2)
            {
                frame.SecondaryBodies.Clear();
            }
            return frame;
        }

        /// <summary>
        /// One side of a frame's pair, named body by body.
        ///
        /// <para>The "no body" index is dropped rather than named, so an empty slot
        /// contributes nothing instead of contributing a null the reader has to
        /// step over.</para>
        /// </summary>
        private static void NameSide(
            List<int> indices, ICelestialNames celestials, List<string> into)
        {
            foreach (var index in indices)
            {
                if (index == NoBody)
                {
                    continue;
                }
                var name = celestials.NameOf(index);
                if (name != null)
                {
                    into.Add(name);
                }
            }
        }

        /// <summary>
        /// The name of a body object, read off its plain field.
        ///
        /// <para><c>bodyName</c> rather than <c>name</c>, and the reason is about
        /// reflection rather than about meaning: the two agree, but the game's
        /// <c>name</c> SHADOWS the engine's own, so a by-name walk up the base chain
        /// can bind either. The plain field is unambiguous.</para>
        /// </summary>
        private string? BodyName(object body)
        {
            var name = _m.ReadString(body, BodyNameMember);
            return string.IsNullOrEmpty(name) ? null : name;
        }

        /// <summary>
        /// An enum member as its declared VALUE, not its position.
        ///
        /// <para>The producer numbers its frame kinds explicitly from 6000, so the
        /// two differ, and a converted ordinal is the number the wire is defined
        /// against. An enum boxes as its own type, which we do not reference, so it
        /// is converted rather than cast.</para>
        /// </summary>
        internal static int? EnumOrdinal(object? value)
        {
            if (value == null)
            {
                return null;
            }
            if (!value.GetType().IsEnum)
            {
                return value as int?;
            }
            try
            {
                return System.Convert.ToInt32(value);
            }
            catch (System.Exception)
            {
                return null;
            }
        }
    }
}
