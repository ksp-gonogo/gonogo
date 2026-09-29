using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// The frame tokens a <see cref="SitrepFrameAttribute"/> may carry. Each is a
    /// <c>const string</c>, so it can be used as an attribute argument and the set
    /// can be emitted as a closed TypeScript union, making a typo a compile error
    /// rather than a second spelling of an existing frame.
    ///
    /// <para>A token names origin and axes together, because neither half is
    /// usable alone: two vectors sharing an origin but not their axes cannot be
    /// subtracted. It states what the wire value is already expressed in. It is
    /// not a transform request, and nothing in the contract converts between
    /// frames.</para>
    ///
    /// <para>The catalog is closed on the C# side and open on the TypeScript
    /// side, as the unit catalog is: an Uplink cannot add a constant to this
    /// class, so it may declare a frame string of its own, and the catalog check
    /// applies only to the payloads this assembly defines.</para>
    ///
    /// <para>There is no "not applicable" token, unlike
    /// <see cref="Units.NotApplicable"/>: a triple of doubles in a spatial
    /// contract has axes, and a genuinely frameless triple should not be a
    /// <see cref="Vec3"/>.</para>
    /// </summary>
    /// <category>Serialization</category>
    public static class Frames
    {
        /// <summary>
        /// Origin at the reference body's centre, axes not rotating with that
        /// body's spin. A fixed-frame Kepler propagation's output is directly
        /// comparable to a value in this frame.
        /// </summary>
        public const string BodyCentredInertial = "body-centred-inertial";

        /// <summary>
        /// Origin at the reference body's centre, axes co-rotating with that
        /// body's spin. KSP uses one or the other per body depending on
        /// <c>CelestialBody.inverseRotation</c>, which is why
        /// <see cref="SitrepFrameAttribute.SelectedBy"/> exists.
        /// </summary>
        public const string BodyCentredRotating = "body-centred-rotating";

        /// <summary>
        /// Origin at the payload's own subject (the active vessel, or the vessel's
        /// own docking port), axes KSP's scene axes. A displacement, never an
        /// absolute position, and not vessel-fixed: the values are a
        /// difference of two world-space quantities, so the subject supplies the
        /// origin and nothing rotates the result into the subject's own axes.
        /// </summary>
        public const string SubjectRelative = "subject-relative";

        /// <summary>
        /// Origin at the vessel's root part, axes the vessel's construction frame:
        /// KSP's <c>Part.orgPos</c> / <c>Part.orgRot</c> pair, which is the
        /// as-assembled layout and does not follow the vessel's flight attitude.
        /// </summary>
        public const string VesselLocal = "vessel-local";

        /// <summary>
        /// Origin and axes of one part's own untransformed mesh. Combining a
        /// part-local vector with a <see cref="VesselLocal"/> one needs that part's
        /// <c>orgRot</c> applied first; the contract ships the raw value and does
        /// not do it for you.
        /// </summary>
        public const string PartLocal = "part-local";
    }

    /// <summary>
    /// Declares which reference frame a <see cref="Vec3"/>-valued property is
    /// expressed in. Required on every <see cref="Vec3"/> property of a contract
    /// payload.
    ///
    /// <para>A position without a frame fails silently: two well-formed vectors
    /// in different frames subtract into a well-formed nonsense vector, with no
    /// null, no exception and no wrong-looking number until someone plots
    /// it.</para>
    ///
    /// <para><b>Per property, never per type.</b> A payload is a bundle of
    /// different fields, and a <see cref="Vec3"/> in one frame can hold a nested
    /// payload whose own vectors are in another: <c>VesselPart.Position</c> is
    /// <see cref="Frames.VesselLocal"/> and the <c>PartBounds</c> hanging off it
    /// is <see cref="Frames.PartLocal"/>.</para>
    ///
    /// <para><b>When the frame changes per tick.</b> An attribute cannot vary per
    /// tick, so a value whose axes switch (as <c>VesselOrbitTruth.Position</c>'s
    /// do with the body's rotation) carries a sibling <c>bool</c> flag on the
    /// same payload, and the attribute names it: <see cref="SelectedBy"/> names
    /// the flag and <see cref="WhenSet"/> the frame it selects.</para>
    ///
    /// <code>
    /// [SitrepFrame(Frames.BodyCentredInertial,
    ///              WhenSet = Frames.BodyCentredRotating,
    ///              SelectedBy = "frameRotating")]
    /// public Vec3 Position { get; set; }
    /// </code>
    ///
    /// <para>Use the pair only where the frame genuinely differs per tick; a
    /// frame that never changes needs no wire flag.</para>
    /// <internal>
    /// Enforced by Sitrep.Core.Tests.FrameCoverageTests, which also resolves
    /// SelectedBy against a real property on the same payload at build time.
    /// </internal>
    /// </summary>
    /// <category>Serialization</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepFrameAttribute : Attribute
    {
        /// <summary>
        /// One of the <see cref="Frames"/> tokens: the frame this value is in,
        /// or the frame it is in when <see cref="SelectedBy"/> is false.
        /// </summary>
        public string Frame { get; }

        /// <summary>
        /// The <see cref="Frames"/> token this value is in INSTEAD when
        /// <see cref="SelectedBy"/> is true. Declared with
        /// <see cref="SelectedBy"/> or not at all.
        /// </summary>
        public string? WhenSet { get; set; }

        /// <summary>
        /// The camelCased name of a <c>bool</c> property on the SAME payload that
        /// says which of <see cref="Frame"/> and <see cref="WhenSet"/> applies to
        /// this tick's value.
        ///
        /// <para>It must be a property of the same payload, so the reference is
        /// checked at build time rather than failing at read time in a
        /// client.</para>
        /// </summary>
        public string? SelectedBy { get; set; }

        /// <summary>Declares the property's frame.</summary>
        /// <param name="frame">One of the <see cref="Frames"/> tokens: the frame the value is in, or the frame it is in when <see cref="SelectedBy"/> is false.</param>
        public SitrepFrameAttribute(string frame)
        {
            Frame = frame;
        }
    }
}
