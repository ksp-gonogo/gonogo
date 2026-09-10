namespace GonogoRp1Uplink
{
    /// <summary>
    /// RP-1's own avionics verdict, exactly as <c>ControlLockerUtils.ShouldLock</c>
    /// returns it. Three states, not two: <see cref="Axial"/> keeps roll authority
    /// and loses everything else, which a boolean cannot say.
    /// </summary>
    /// <remarks>
    /// A local mirror of <c>RP0.ControlLockerUtils.LockLevel</c> rather than the
    /// enum itself, because this assembly never links RP0.dll. The ordinals are
    /// RP-1's own, so a value read off the reflected call maps across by number,
    /// and <see cref="Rp1AvionicsCapture"/> refuses one that does not.
    /// </remarks>
    public enum Rp1LockLevel
    {
        /// <summary>No control at all: pitch, yaw, roll and translation are held at zero.</summary>
        Locked = 0,

        /// <summary>Roll only. The vessel can be rolled and cannot be steered.</summary>
        Axial = 1,

        /// <summary>Full control. The avionics fitted cover the vessel's mass.</summary>
        Unlocked = 2,
    }

    /// <summary>
    /// One reading of RP-1's control locker: the verdict and the three facts it
    /// hands back with it. KSP-free, so the mapper below it and its tests never
    /// pull in the reflection or the game surface.
    /// </summary>
    /// <remarks>
    /// <para>Every field is nullable and every one of them means the same thing
    /// when null: RP-1 was not asked, or did not answer. The four travel together
    /// because <c>ShouldLock</c> produces them together, in one call, out of one
    /// walk of the part list; there is no state in which three are known and the
    /// fourth is not.</para>
    ///
    /// <para><b>The masses are RP-1's, not the vessel's own.</b>
    /// <see cref="VesselMassTons"/> is the figure <c>ShouldLock</c> compares
    /// against, which is NOT <c>Vessel.totalMass</c>: in the editor and at
    /// PRELAUNCH it zeroes launch clamps and any part hanging off pad
    /// infrastructure. Clamps are heavy, so the two disagree by the most at the
    /// exact moment an operator is reading the number.</para>
    /// </remarks>
    public sealed class Rp1AvionicsRaw
    {
        /// <summary>What RP-1 will do to the controls, from its own decision.</summary>
        public Rp1LockLevel? Level;

        /// <summary>
        /// The mass the fitted avionics support (tonnes): RP-1's <c>maxMass</c>,
        /// the MAX across parts of each part's summed <c>CurrentMassLimit</c>,
        /// counting only units that have electricity reaching them.
        /// </summary>
        public double? SupportedMassTons;

        /// <summary>
        /// The mass RP-1 weighed against that limit (tonnes): its own
        /// <c>vesselMass</c>, clamp- and pad-infrastructure-zeroed as described
        /// on the type.
        /// </summary>
        public double? VesselMassTons;

        /// <summary>
        /// Whether some fitted unit is an interplanetary-rated one held to its
        /// near-Earth limit. A SECOND lock reason on top of the tonnage: a vessel
        /// can be inside its supported mass on paper and still be limited by this,
        /// and RP-1 posts its own separate reminder for it.
        /// </summary>
        public bool? LimitedByNonInterplanetary;
    }
}
