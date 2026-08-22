using System;
using System.Collections.Generic;
using System.Reflection;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads and writes the producer's own burn struct by field, and refuses to
    /// touch anything else.
    ///
    /// <para><b>Why a field write on a third-party object is safe, and why this is
    /// a separate type from <see cref="ReflectedMembers"/>.</b> That type's whole
    /// argument is about reads: a field read runs no producer code, a property read
    /// runs a getter, and a getter here can reach a fatal log. The write side has
    /// the same shape and the same asymmetry. Assigning a FIELD runs nothing;
    /// assigning a PROPERTY runs a setter, and one of the setters on this very
    /// struct family (<c>PrimaryIndices</c>) throws on a set of the wrong size. So
    /// <see cref="Set"/> resolves fields only and refuses a property outright,
    /// rather than being tolerant about it the way the read side can afford to
    /// be.</para>
    ///
    /// <para><b>Why nothing here ever constructs a burn.</b> The struct the plugin
    /// takes is generated at the producer's build time from a schema that changed
    /// in the release this Uplink is keyed to: one field was added and another
    /// removed. A composed burn with a stale field set does not fail to resolve and
    /// does not throw; it writes a plausible wrong burn into the player's save.
    /// Every burn that reaches the plugin from here came OUT of the plugin first,
    /// with named fields changed on it. That is layout-agnostic in a way a literal
    /// is not, and it is why <see cref="Mutate"/> takes an existing burn rather
    /// than a description of one.</para>
    ///
    /// <para>Nothing in this file names a Principia type. Every member is reached
    /// by name, so the whole thing is exercisable against a stand-in that declares
    /// the same field names, which is what makes the mutation rules testable
    /// without the game.</para>
    /// </summary>
    public sealed class PrincipiaBurnStruct
    {
        /// <summary>Fields on the burn itself.</summary>
        internal const string ThrustField = "thrust_in_kilonewtons";
        internal const string SpecificImpulseField = "specific_impulse_in_seconds_g0";
        internal const string InitialTimeField = "initial_time";
        internal const string InertiallyFixedField = "is_inertially_fixed";
        internal const string IntensityField = "intensity";
        internal const string FrameField = "frame";

        /// <summary>Fields on the intensity, which carries the Δv.</summary>
        internal const string CoordinateSystemField = "coordinate_system_";
        internal const string XyzField = "xyz";

        internal const string XField = "x";
        internal const string YField = "y";
        internal const string ZField = "z";

        /// <summary>The frame's kind, and the only field on it this Uplink
        /// reads.</summary>
        internal const string ExtensionField = "extension";

        /// <summary>
        /// Fields on the manoeuvre, which is the burn plus everything the plugin
        /// computed from it.
        ///
        /// <para>This is where the planned PROFILE comes from, and it is why the
        /// plan is worth reading from the plugin at all rather than from the
        /// producer's window: the window's burn editor carries a Dv magnitude and
        /// three sliders, while the plugin answers with the mass the vessel will
        /// have at cutoff, the rate it sheds it at, and how long until half the Dv
        /// is spent. An integrated burn's arc depends on all three.</para>
        /// </summary>
        internal const string ManoeuvreBurnField = "burn";
        internal const string ManoeuvreInitialMassField = "initial_mass_in_tonnes";
        internal const string ManoeuvreFinalMassField = "final_mass_in_tonnes";
        internal const string ManoeuvreMassFlowField = "mass_flow";
        internal const string ManoeuvreDurationField = "duration";
        internal const string ManoeuvreFinalTimeField = "final_time";
        internal const string ManoeuvreTimeToHalfDeltaVField = "time_to_half_delta_v";

        /// <summary>
        /// The frame kinds a burn may be sent back with.
        ///
        /// <para>Body-centred non-rotating, body-centred parent-direction and body
        /// surface. Two more are constructible in principle and neither is
        /// permitted: barycentric-rotating is never produced by any of the
        /// producer's own selectors and carries five constructor invariants, one of
        /// which fires when a frame names the same body twice; rotating-pulsating
        /// has no case at all in the producer's frame factory and reaching it is a
        /// fatal log, which is to say the KSP process ends. The only thing standing
        /// between "make this burn use my plotting frame" and that is a managed cast
        /// operator that quietly answers null for the pulsating kind, and a cast
        /// operator is invisible from where we stand.</para>
        /// </summary>
        public static readonly int[] EditableFrameExtensions = { 6000, 6002, 6003 };

        /// <summary>The Cartesian coordinate system, the one whose three Δv
        /// components are the whole of the intensity. The other three members of
        /// the producer's enum are spherical and carry the magnitude and two angles
        /// instead, so a component edit against one of those would write a triple
        /// the plugin does not read.</summary>
        public const int CartesianTnb = 1;

        private readonly Dictionary<string, FieldInfo?> _fields = new Dictionary<string, FieldInfo?>();

        /// <summary>True when <paramref name="extension"/> is a frame kind a burn
        /// may carry back to the plugin.</summary>
        public static bool IsEditableFrame(int extension) =>
            Array.IndexOf(EditableFrameExtensions, extension) >= 0;

        /// <summary>
        /// The named field's value, or null when the object does not carry that
        /// field.
        ///
        /// <para>Null is not "the value was null": it is "this is not the shape
        /// that was analysed", and every caller here turns it into a refusal rather
        /// than into a default.</para>
        /// </summary>
        public object? Get(object target, string name)
        {
            var field = Field(target.GetType(), name);
            if (field == null)
            {
                return null;
            }
            try
            {
                return field.GetValue(target);
            }
            catch (Exception)
            {
                return null;
            }
        }

        public double? GetDouble(object target, string name) =>
            ReflectedMembers.AsDouble(Get(target, name));

        public bool? GetBool(object target, string name) => Get(target, name) as bool?;

        /// <summary>The named field as an int, accepting the byte and long forms
        /// the producer's structs use for enums and step counts.</summary>
        public int? GetInt(object target, string name) =>
            Get(target, name) switch
            {
                int i => i,
                byte b => b,
                long l => (int)l,
                short s => s,
                _ => null,
            };

        /// <summary>
        /// Assigns a FIELD, and answers false when there is no such field.
        ///
        /// <para>A property of the same name is refused rather than assigned: a
        /// setter is producer code, and this whole layer exists because producer
        /// code on this surface can end the process. False here always becomes a
        /// refused write, never a partly-applied one.</para>
        /// </summary>
        public bool Set(object target, string name, object? value)
        {
            var field = Field(target.GetType(), name);
            if (field == null)
            {
                return false;
            }
            try
            {
                field.SetValue(target, value);
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Every field this Uplink must find on a burn before it will send one
        /// back, so a shape change is a named refusal rather than a silent
        /// half-write.
        /// </summary>
        public string? MissingBurnField(object burn)
        {
            foreach (var name in new[]
                     {
                         ThrustField, SpecificImpulseField, InitialTimeField,
                         InertiallyFixedField, IntensityField, FrameField,
                     })
            {
                if (Field(burn.GetType(), name) == null)
                {
                    return name;
                }
            }

            var intensity = Get(burn, IntensityField);
            if (intensity == null)
            {
                return IntensityField;
            }
            foreach (var name in new[] { CoordinateSystemField, XyzField })
            {
                if (Field(intensity.GetType(), name) == null)
                {
                    return name;
                }
            }

            var xyz = Get(intensity, XyzField);
            if (xyz == null)
            {
                return XyzField;
            }
            foreach (var name in new[] { XField, YField, ZField })
            {
                if (Field(xyz.GetType(), name) == null)
                {
                    return name;
                }
            }

            return null;
        }

        /// <summary>
        /// The burn's Δv triple, or null when the intensity could not be read.
        /// </summary>
        public PrincipiaVector? DeltaV(object burn)
        {
            var intensity = Get(burn, IntensityField);
            if (intensity == null)
            {
                return null;
            }
            var xyz = Get(intensity, XyzField);
            if (xyz == null)
            {
                return null;
            }
            return new PrincipiaVector(
                GetDouble(xyz, XField) ?? 0.0,
                GetDouble(xyz, YField) ?? 0.0,
                GetDouble(xyz, ZField) ?? 0.0);
        }

        /// <summary>The intensity's coordinate system, as the producer's own enum
        /// ordinal.</summary>
        public int? CoordinateSystem(object burn)
        {
            var intensity = Get(burn, IntensityField);
            return intensity == null ? null : GetInt(intensity, CoordinateSystemField);
        }

        /// <summary>The burn's frame kind, as the producer's own extension
        /// number.</summary>
        public int? FrameExtension(object burn)
        {
            var frame = Get(burn, FrameField);
            return frame == null ? null : GetInt(frame, ExtensionField);
        }

        /// <summary>
        /// Writes a new Δv triple onto a burn read back from the plugin.
        ///
        /// <para>The intensity is a value type on the burn, so it is read out,
        /// changed on the boxed copy, and written back whole. Changing the box and
        /// forgetting the write-back is the bug this method exists to not have: it
        /// leaves the burn holding its original Δv while every local variable says
        /// otherwise, and the write then lands successfully with the wrong
        /// numbers.</para>
        /// </summary>
        public bool SetDeltaV(object burn, double tangent, double normal, double binormal)
        {
            var intensity = Get(burn, IntensityField);
            if (intensity == null)
            {
                return false;
            }
            var xyz = Get(intensity, XyzField);
            if (xyz == null)
            {
                return false;
            }
            if (!Set(xyz, XField, tangent) || !Set(xyz, YField, normal) || !Set(xyz, ZField, binormal))
            {
                return false;
            }
            return Set(intensity, XyzField, xyz) && Set(burn, IntensityField, intensity);
        }

        private FieldInfo? Field(Type type, string name)
        {
            var key = type.FullName + "." + name;
            if (_fields.TryGetValue(key, out var cached))
            {
                return cached;
            }
            FieldInfo? found = null;
            for (var t = type; t != null && found == null; t = t.BaseType)
            {
                found = t.GetField(
                    name,
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            }
            _fields[key] = found;
            return found;
        }
    }
}
