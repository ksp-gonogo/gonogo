using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>What a caller states to make the first burn of a plan.</summary>
    public readonly struct ComposedBurnRequest
    {
        public ComposedBurnRequest(
            double ignitionUt,
            double deltaVTangent,
            double deltaVNormal,
            double deltaVBinormal,
            bool inertiallyFixed,
            double thrustKilonewtons,
            double specificImpulseSeconds,
            int frameExtension,
            int centreBodyIndex,
            int primaryBodyIndex = PrincipiaBurnStruct.NoBody,
            int secondaryBodyIndex = PrincipiaBurnStruct.NoBody)
        {
            IgnitionUt = ignitionUt;
            DeltaVTangent = deltaVTangent;
            DeltaVNormal = deltaVNormal;
            DeltaVBinormal = deltaVBinormal;
            InertiallyFixed = inertiallyFixed;
            ThrustKilonewtons = thrustKilonewtons;
            SpecificImpulseSeconds = specificImpulseSeconds;
            FrameExtension = frameExtension;
            CentreBodyIndex = centreBodyIndex;
            PrimaryBodyIndex = primaryBodyIndex;
            SecondaryBodyIndex = secondaryBodyIndex;
        }

        public double IgnitionUt { get; }
        public double DeltaVTangent { get; }
        public double DeltaVNormal { get; }
        public double DeltaVBinormal { get; }
        public bool InertiallyFixed { get; }
        public double ThrustKilonewtons { get; }
        public double SpecificImpulseSeconds { get; }

        /// <summary>The producer's own frame ordinal, from its <c>FrameType</c>.</summary>
        public int FrameExtension { get; }

        /// <summary>The body the frame is centred on, as the game indexes bodies.
        /// Read only by the kinds that centre on one body.</summary>
        public int CentreBodyIndex { get; }

        /// <summary>The body a direction frame points AT.</summary>
        public int PrimaryBodyIndex { get; }

        /// <summary>The body a direction frame is centred ON. Read with
        /// <see cref="PrimaryBodyIndex"/> and only by that kind.</summary>
        public int SecondaryBodyIndex { get; }
    }

    /// <summary>
    /// Builds the FIRST burn of a plan, which is the one there is no existing
    /// burn to copy.
    ///
    /// <para><b>The struct comes from the loaded build, not from a shape written
    /// here.</b> Every field an instance carries is a field this build declares,
    /// so a schema that moved between releases cannot leave a stale one behind. A
    /// literal would not fail to resolve and would not throw; it would write a
    /// plausible wrong burn into the player's save, which is the failure the
    /// copy-an-existing-burn rule exists to prevent. Constructing from the
    /// producer's own type has the same property the copy has, by the same
    /// mechanism.</para>
    ///
    /// <para><b>The frame is the one thing named by constant, and it is bounded.</b>
    /// The plugin has no call that hands one back: the plotting frame is
    /// write-only across its C boundary, and the only frame it will return comes
    /// off an existing manoeuvre. So the kind and the bodies are stated, exactly as
    /// the producer's own planner states them, and every one of them is checked
    /// before anything is written: a body index the game does not have reaches an
    /// unguardable lookup on the native side and takes the process down.</para>
    ///
    /// <para><b>The slots a kind does not read are written anyway, to a fixed
    /// value.</b> The producer's switch reads the centre for the centred kinds and
    /// the pair for the direction kind, and never looks at the rest. What it does
    /// not look at, it does not validate, so leaving a slot at whatever a fresh
    /// struct happened to hold is a frame that is meaningful and wrong rather than
    /// obviously broken. A fresh struct's centre is zero, which is the Sun.</para>
    /// </summary>
    public sealed class PrincipiaBurnComposer
    {
        private readonly PrincipiaBurnStruct _fields;

        public PrincipiaBurnComposer(PrincipiaBurnStruct fields)
        {
            _fields = fields ?? throw new ArgumentNullException(nameof(fields));
        }

        /// <summary>
        /// A burn ready to hand to the producer, or null with a reason.
        ///
        /// <param name="knownBodyIndices">Every body index the running game has,
        /// which is what makes the centre check possible at all. An empty set
        /// refuses rather than waving the check through: not knowing the bodies
        /// is not the same as the index being fine.</param>
        /// </summary>
        public object? Compose(
            Type? burnType,
            ComposedBurnRequest request,
            System.Collections.Generic.IReadOnlyCollection<int> knownBodyIndices,
            out string? refusal)
        {
            refusal = null;

            if (burnType == null)
            {
                refusal =
                    "The producer's burn type could not be read from its own interface, so "
                    + "there is nothing to build one from.";
                return null;
            }
            if (!PrincipiaBurnStruct.IsEditableFrame(request.FrameExtension))
            {
                refusal =
                    "That frame is not one a burn may be written in. A burn sent in a frame "
                    + "the producer will not accept is refused on arrival at best.";
                return null;
            }
            if (knownBodyIndices.Count == 0)
            {
                refusal =
                    "The body table has not arrived, so the frame's bodies cannot be checked. "
                    + "An index the game does not have reaches a lookup on the native side "
                    + "that ends the process rather than returning.";
                return null;
            }

            var centred = PrincipiaBurnStruct.FrameCentresOnOneBody(request.FrameExtension);
            if (centred)
            {
                if (!Contains(knownBodyIndices, request.CentreBodyIndex))
                {
                    refusal = NoSuchBody;
                    return null;
                }
            }
            else
            {
                if (!Contains(knownBodyIndices, request.PrimaryBodyIndex)
                    || !Contains(knownBodyIndices, request.SecondaryBodyIndex))
                {
                    refusal = NoSuchBody;
                    return null;
                }
                if (request.PrimaryBodyIndex == request.SecondaryBodyIndex)
                {
                    // The direction is from one body to the other, so a frame naming
                    // the same body twice has no direction to be built from.
                    refusal =
                        "A frame built from a pair of bodies cannot name the same body twice; "
                        + "there is no direction between a body and itself.";
                    return null;
                }
            }
            if (!(request.ThrustKilonewtons > 0) || !(request.SpecificImpulseSeconds > 0))
            {
                // Both divide inside the producer's own burn integration. Zero is
                // accepted by the struct and poisons every duration in the plan.
                refusal =
                    "A burn needs a thrust and a specific impulse above zero; the producer "
                    + "divides by both and accepts zero without complaint.";
                return null;
            }
            if (!IsFinite(request.IgnitionUt)
                || !IsFinite(request.DeltaVTangent)
                || !IsFinite(request.DeltaVNormal)
                || !IsFinite(request.DeltaVBinormal))
            {
                refusal = "A burn cannot be built from a value that is not a number.";
                return null;
            }

            object? burn;
            try
            {
                burn = Activator.CreateInstance(burnType);
            }
            catch (Exception e)
            {
                refusal = "The producer's burn type could not be constructed: " + e.Message;
                return null;
            }
            if (burn == null)
            {
                refusal = "The producer's burn type constructed to nothing.";
                return null;
            }

            // Every field by name, through the same writer the copy path uses, so
            // a field this build does not have is refused rather than silently
            // skipped.
            if (!_fields.Set(burn, PrincipiaBurnStruct.ThrustField, request.ThrustKilonewtons)
                || !_fields.Set(
                    burn,
                    PrincipiaBurnStruct.SpecificImpulseField,
                    request.SpecificImpulseSeconds)
                || !_fields.Set(burn, PrincipiaBurnStruct.InitialTimeField, request.IgnitionUt)
                || !_fields.Set(
                    burn,
                    PrincipiaBurnStruct.InertiallyFixedField,
                    request.InertiallyFixed))
            {
                refusal =
                    "This build's burn does not carry a field this one needs, so what was "
                    + "written would not be the burn that was asked for.";
                return null;
            }

            if (!_fields.SetDeltaV(
                    burn,
                    request.DeltaVTangent,
                    request.DeltaVNormal,
                    request.DeltaVBinormal))
            {
                refusal = "The burn's delta-v could not be written.";
                return null;
            }

            if (!SetFrame(burn, request, centred))
            {
                refusal = "The burn's frame could not be written.";
                return null;
            }

            // The same check the copy path runs, last, so a burn that is missing
            // anything at all never leaves here.
            var missing = _fields.MissingBurnField(burn);
            if (missing != null)
            {
                refusal = "The composed burn has no " + missing + " field.";
                return null;
            }

            return burn;
        }

        /// <summary>
        /// Writes the frame's kind and all three body slots onto the burn, through
        /// the same box-and-write dance the delta-v takes: these are value types, so
        /// a nested member has to go back after it is changed or the change lands on
        /// a copy.
        /// </summary>
        private bool SetFrame(object burn, ComposedBurnRequest request, bool centred)
        {
            var frame = _fields.Get(burn, PrincipiaBurnStruct.FrameField);
            if (frame == null)
            {
                return false;
            }

            var centre = centred ? request.CentreBodyIndex : PrincipiaBurnStruct.UnsetCentre;
            var primary = centred ? PrincipiaBurnStruct.NoBody : request.PrimaryBodyIndex;
            var secondary = centred ? PrincipiaBurnStruct.NoBody : request.SecondaryBodyIndex;

            return _fields.Set(frame, PrincipiaBurnStruct.ExtensionField, request.FrameExtension)
                && _fields.Set(frame, PrincipiaBurnStruct.CentreIndexField, centre)
                && _fields.Set(frame, PrincipiaBurnStruct.PrimaryIndexField, primary)
                && _fields.Set(frame, PrincipiaBurnStruct.SecondaryIndexField, secondary)
                && _fields.Set(burn, PrincipiaBurnStruct.FrameField, frame);
        }

        private const string NoSuchBody =
            "No such body in this game, so the frame cannot be built on it. The native "
            + "lookup for a missing index ends the process rather than returning.";

        private static bool Contains(
            System.Collections.Generic.IReadOnlyCollection<int> indices, int wanted)
        {
            foreach (var index in indices)
            {
                if (index == wanted) return true;
            }
            return false;
        }

        private static bool IsFinite(double value) =>
            !double.IsNaN(value) && !double.IsInfinity(value);
    }
}
