using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// The definitive link-DOWN payloads for the RA-only comms channels
    /// (comms-uplink-design.md §4.3). Pure (KSP-free) so it is headlessly
    /// testable alongside <see cref="RaLinkBudget"/>.
    ///
    /// <para>These are PUBLISHED (not withheld) when the vessel's comms link is
    /// not connected. The RA-only channels are <c>LossyLatest</c>, so leaving
    /// them unpublished on a down link would strand the last-good GEOMETRIC value
    /// on the wire — the bug where <c>comms.linkMargin</c> reported
    /// <c>closesLink:true</c> with a healthy positive margin while
    /// <c>comms.connectivity</c> correctly reported <c>connected:false</c>. A
    /// geometry-only budget ignores occlusion / out-of-cone relays, so it must
    /// never be the authority on whether the link closes — CommNet connectivity
    /// is. When the link is down these report the honest state: the link does
    /// NOT close, quality is nil, throughput is a genuine zero.</para>
    /// </summary>
    public static class RaLinkDown
    {
        public static CommsLinkMargin LinkMargin(string source) => new CommsLinkMargin
        {
            DecibelMargin = 0.0,
            ClosesLink = false,
            Meta = new PayloadMeta { Source = source, Quality = Quality.Loaded },
        };

        public static CommsLinkQuality LinkQuality(string source) => new CommsLinkQuality
        {
            Value = 0.0,
            Meta = new PayloadMeta { Source = source, Quality = Quality.Loaded },
        };

        public static CommsDataRate DataRate(string source) => new CommsDataRate
        {
            UpBitsPerSec = 0.0,
            DownBitsPerSec = 0.0,
            Meta = new PayloadMeta { Source = source, Quality = Quality.Loaded },
        };
    }
}
