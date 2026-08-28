using System.Collections.Generic;

namespace GonogoRealFuelsUplink
{
    /// <summary>
    /// One engine as reflection found it, before any of RealFuels' overloaded
    /// meanings are unpicked. KSP-free so the pure mapper and its headless tests
    /// never pull in the reflection or KSP surface.
    ///
    /// <para>Every field is nullable and a null means the member could not be
    /// read, which is why <see cref="Ignitions"/> is an <c>int?</c> rather than
    /// an <c>int</c> defaulted to zero: zero is a real budget state under this
    /// mod.</para>
    /// </summary>
    public sealed class RealFuelsEngineRaw
    {
        public long? PartId;
        public string? PartName;
        public int? Ignitions;
        public bool? LiteralZeroIgnitions;
        public bool? UllageModelled;
        public double? UllageStability;
        public double? IgnitionProbability;
        public bool? PressureFed;
        public bool? FeedPressureOk;
        public double? RatedBurnTimeSeconds;
        public double? RatedContinuousBurnTimeSeconds;
        public double? PredictedMaximumResiduals;
    }

    /// <summary>
    /// The vessel's engines under the two game-wide RealFuels switches that
    /// decide whether their ignition and ullage readings bind.
    /// </summary>
    public sealed class RealFuelsVesselRaw
    {
        public bool? IgnitionsLimited;
        public bool? UllageSimulated;
        public List<RealFuelsEngineRaw> Engines = new List<RealFuelsEngineRaw>();
    }

    /// <summary>
    /// The vessel's boiloff as RealFuels holds it: an accumulated MASS and the
    /// interval it accumulated over, kept apart so the mapper can turn them into
    /// a rate or decline to (see <see cref="RealFuelsCapture.BuildBoiloff"/>).
    /// </summary>
    public sealed class RealFuelsBoiloffRaw
    {
        public double? BoiloffMassTons;
        public double? IntervalSeconds;
        public int CryogenicTankCount;
    }
}
