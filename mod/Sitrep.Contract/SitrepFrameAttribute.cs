using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// The canonical frame tokens a <see cref="SitrepFrameAttribute"/> may carry.
    /// Every token is a <c>const string</c> for the same two reasons
    /// <see cref="Units"/>' are: it can be used as an attribute argument, and the
    /// set can be emitted as a closed TypeScript union so a typo is a COMPILE
    /// error on both sides rather than a second spelling of an existing frame.
    ///
    /// <para>A token names ORIGIN and AXES together, because neither half is
    /// usable alone: two vectors sharing an origin but not their axes are no more
    /// subtractable than two vectors sharing neither. It states what the wire
    /// value is ALREADY expressed in. It is not a transform request, and nothing
    /// in the contract ever converts between frames.</para>
    ///
    /// <para>This catalog is closed and the TypeScript side is not, exactly as
    /// the unit catalog is: a third-party Uplink cannot add a <c>const</c> to a
    /// class compiled into this assembly, so a closed wire type would have meant
    /// an Uplink could never declare a frame at all. The catalog check therefore
    /// applies to first-party payloads, which is the set it can see.</para>
    ///
    /// <para><b>There is deliberately no "not applicable" token, and
    /// <see cref="Units.NotApplicable"/> is not the precedent it looks like.</b>
    /// That one earns its place because ids, flags and text genuinely have no
    /// dimension, and they are most of the unit surface. Nothing here is
    /// analogous: a triple of doubles in a spatial contract has axes, and the
    /// honest answer to a genuinely frameless triple is that it should not be a
    /// <see cref="Vec3"/>. An escape hatch over a surface this small is a
    /// loophole the width of the surface.</para>
    /// </summary>
    public static class Frames
    {
        /// <summary>
        /// Origin at the reference body's centre, axes NOT rotating with that
        /// body's spin. The frame a fixed-frame Kepler propagator's output is
        /// directly comparable to.
        /// </summary>
        public const string BodyCentredInertial = "body-centred-inertial";

        /// <summary>
        /// Origin at the reference body's centre, axes CO-ROTATING with that
        /// body's spin. KSP hands out one or the other per body
        /// (<c>CelestialBody.inverseRotation</c>), which is why
        /// <see cref="SitrepFrameAttribute.SelectedBy"/> exists.
        /// </summary>
        public const string BodyCentredRotating = "body-centred-rotating";

        /// <summary>
        /// Origin at the payload's own subject (the active vessel, or the vessel's
        /// own docking port), axes KSP's scene axes. A DISPLACEMENT, never an
        /// absolute position, and emphatically not vessel-fixed: the values are a
        /// difference of two world-space quantities, so the subject supplies the
        /// origin and nothing rotates the result into the subject's own axes.
        /// </summary>
        public const string SubjectRelative = "subject-relative";

        /// <summary>
        /// Origin at the vessel's root part, axes the vessel's CONSTRUCTION frame:
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
    /// expressed in. Required on every one of them: see
    /// <c>Sitrep.Core.Tests.FrameCoverageTests</c>, which is the enforcement and
    /// the reason this is a rule rather than a habit.
    ///
    /// <para>A position without a frame is not a weakly-typed position, it is not
    /// a position at all, and the failure it produces is silent: two well-formed
    /// vectors subtract into a well-formed nonsense vector with no null, no
    /// exception and no wrong-looking number until someone plots it. Frame sat in
    /// exactly the category units sat in before <see cref="SitrepUnitAttribute"/>,
    /// a per-payload convention documented in prose that nothing checked, and it
    /// gets the same treatment.</para>
    ///
    /// <para><b>Per property, never per type.</b> The same reasoning
    /// <see cref="SitrepReckonableAttribute"/> sets out: a payload is a bundle of
    /// heterogeneous fields and marking the bundle stamps a frame on fields that
    /// have no spatial content at all. It is also untrue in the tree we already
    /// have, where a <see cref="Vec3"/> in one frame holds a nested payload whose
    /// own vectors are in another: <c>VesselPart.Position</c> is
    /// <see cref="Frames.VesselLocal"/> and the <c>PartBounds</c> hanging off it
    /// is <see cref="Frames.PartLocal"/>.</para>
    ///
    /// <para><b>The frame KIND is static; a DISCRIMINANT is not.</b>
    /// <c>VesselPart.Position</c> is vessel-local on every tick that has ever
    /// existed, so an attribute carries it and a build-time gate checks it.
    /// <c>VesselOrbitTruth.Position</c> is body-centred on every tick too, but
    /// whether its axes rotate flips with the body, which is why that payload grew
    /// a sibling <c>FrameRotating</c> flag. An attribute cannot vary per tick and a
    /// wire field cannot be checked at build time, so the flag SITS BESIDE this
    /// attribute and this attribute NAMES it: <see cref="SelectedBy"/> plus
    /// <see cref="WhenSet"/> turn what was a prose convention into a declaration
    /// the gate resolves against a real property on the same payload.</para>
    ///
    /// <code>
    /// [SitrepFrame(Frames.BodyCentredInertial,
    ///              WhenSet = Frames.BodyCentredRotating,
    ///              SelectedBy = "frameRotating")]
    /// public Vec3 Position { get; set; }
    /// </code>
    ///
    /// <para>Reach for the pair only where the frame genuinely differs per tick.
    /// Requiring a sibling wire flag everywhere was the rejected alternative: it
    /// puts a per-tick field on the wire to carry a fact that never changes.</para>
    /// </summary>
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
        /// <para>Same-payload on purpose. A central frame table with a reference
        /// held here was the considered alternative and it turns a missing frame
        /// into a dangling reference that fails at read time in a client, which is
        /// strictly worse when the whole point is catching it early. A sibling
        /// property is resolved by the coverage gate at build time.</para>
        /// </summary>
        public string? SelectedBy { get; set; }

        public SitrepFrameAttribute(string frame)
        {
            Frame = frame;
        }
    }
}
