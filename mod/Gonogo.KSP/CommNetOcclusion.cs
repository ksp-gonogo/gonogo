using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Stock CommNet's declared occlusion geometry: the model
    /// <see cref="CommNetBackend.OcclusionModel"/> hands back.
    ///
    /// <para>Stock does not test a radio path against the rock. It shrinks the
    /// body first, by <c>CommNetParams.occlusionMultiplierVac</c> when the body
    /// is airless and <c>occlusionMultiplierAtm</c> when it has an atmosphere,
    /// and tests against that. Kerbin therefore occludes as a 450 km sphere,
    /// not a 600 km one, and a vessel stays in contact well past the point
    /// where the horizon says it shouldn't.</para>
    ///
    /// <para>Deliberately KSP-free so both the rule and its stock defaults can
    /// be exercised headlessly next to RealAntennas' declaration; the live read
    /// of the two multipliers stays in <see cref="CommNetBackend"/>, on the
    /// capture-on-main seam.</para>
    /// </summary>
    public static class CommNetOcclusion
    {
        public const string ModelId = "commnet-scaled-radius";

        public const string ModelName = "Stock CommNet (occlusion multipliers)";

        /// <summary>
        /// <c>CommNetParams.occlusionMultiplierVac</c>'s own field initialiser.
        /// The fallback when the live parameters can't be read (main menu, no
        /// game loaded), and the value a Normal-difficulty game carries.
        /// </summary>
        public const double StockVacuumMultiplier = 0.9;

        /// <summary><c>CommNetParams.occlusionMultiplierAtm</c>'s own field initialiser; see <see cref="StockVacuumMultiplier"/>.</summary>
        public const double StockAtmosphereMultiplier = 0.75;

        /// <summary>
        /// The model for a game running the given multipliers. Both are player-
        /// settable (the difficulty presets range from 0/0, nothing occludes, to
        /// 1/1, everything occludes at its bare radius), so they are arguments
        /// rather than constants baked into the rule.
        /// </summary>
        public static ICommsOcclusionModel Model(double vacuumMultiplier, double atmosphereMultiplier) =>
            new ScaledRadiusOcclusionModel(ModelId, ModelName, vacuumMultiplier, atmosphereMultiplier);

        /// <summary>The model for a stock-default game; see <see cref="StockVacuumMultiplier"/>.</summary>
        public static ICommsOcclusionModel StockDefaults() =>
            Model(StockVacuumMultiplier, StockAtmosphereMultiplier);
    }
}
