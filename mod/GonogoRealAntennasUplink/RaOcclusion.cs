using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// RealAntennas' declared occlusion geometry: the model
    /// <see cref="RaCommsBackend.OcclusionModel"/> hands back.
    ///
    /// <para>RA occludes at the body's BARE radius. Its own line-of-sight test
    /// (<c>FilterCommNodesByOcclusion.Occluded</c>, a segment-to-sphere distance
    /// check) takes <c>body.Radius</c> straight, and the occluder set it
    /// precomputes (<c>Precompute.SetupOccluders</c>) is built from the same
    /// value. No multiplier is read anywhere on that path, so stock's
    /// <c>occlusionMultiplierVac</c>/<c>Atm</c> have no effect under RA even
    /// though the difficulty settings still carry them.</para>
    ///
    /// <para>Expressed as a scaled-radius model at 1.0/1.0 rather than as its
    /// own type: "the bare radius" IS radius x 1, and sharing the one rule
    /// keeps the two backends' declarations directly comparable. Deliberately
    /// KSP-free (and RA-reflection-free) so it can be exercised headlessly.</para>
    /// </summary>
    public static class RaOcclusion
    {
        public const string ModelId = "realantennas-bare-radius";

        public const string ModelName = "RealAntennas (bare body radius)";

        public static readonly ICommsOcclusionModel Model =
            new ScaledRadiusOcclusionModel(ModelId, ModelName, 1.0, 1.0);
    }
}
