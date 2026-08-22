using System.Collections.Generic;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// Builds the <c>"realantennas"</c> namespace of a <c>CommsHop</c>'s provider
    /// extension bag from the live RACommLink, via <see cref="RaReflection"/>. The
    /// provider-extension pattern (see a sibling Uplink's reliability map): a plain
    /// value tree with camelCase keys matching the generated <c>RealAntennasHopExt</c>
    /// interface field for field, which the wire writer walks like any other
    /// producer-flattened payload. Core never learns this shape.
    ///
    /// <para>Main-thread only (live antenna reads), called from
    /// <see cref="RaCommsBackend.Path"/> inside the capture-on-main sampler. Every
    /// field is a fail-soft <see cref="RaReflection"/> read, so a moved RA surface
    /// drops individual fields to null rather than throwing; when nothing at all
    /// reads (bare CommNet, or a wholly unfamiliar RA), the bag is null and the wire
    /// omits it, so the hop is byte-for-byte the shared shape.</para>
    /// </summary>
    public static class RaHopExtensions
    {
        /// <summary>
        /// The provider id keying the namespace: the same string
        /// <see cref="RaCommsBackend.Id"/> registers with the Kernel, and what the
        /// client's <c>registerProviderExtensionShape</c> names.
        /// </summary>
        public const string ProviderId = RaCommsBackend.Id;

        /// <summary>
        /// The full extension bag for one hop (<c>{ "realantennas": { ... } }</c>),
        /// or null when no RA fact reads. Band/tech-level/modulation/encoder/coding
        /// rate/beamwidth/EC draw come off the FORWARD transmit antenna; required
        /// Eb/N0 off the forward RECEIVE antenna (its encoder sets the requirement);
        /// the reverse rate off the link. <paramref name="link"/> is the live
        /// RACommLink.
        /// </summary>
        public static Dictionary<string, object?>? ForHop(RaReflection ra, object? link)
        {
            if (link == null)
            {
                return null;
            }

            var tx = ra.ForwardTxAntenna(link);
            var rx = ra.ForwardRxAntenna(link);

            var band = tx != null ? ra.BandName(tx) : null;
            var techLevel = tx != null ? ra.TechLevel(tx) : null;
            var modulationBits = tx != null ? ra.ModulationBits(tx) : null;
            var encoder = tx != null ? ra.EncoderName(tx) : null;
            var codingRate = tx != null ? ra.CodingRate(tx) : null;
            var beamwidth = tx != null ? ra.Beamwidth(tx) : null;
            var powerDrawEc = tx != null ? ra.PowerDrawLinear(tx) : null;
            var requiredEbN0 = rx != null ? ra.RequiredEbN0Db(rx) : null;
            var reverseBitsPerSec = ra.ReverseDataRate(link);

            // Nothing read at all: leave the bag off so the hop is the bare shared
            // shape (the vanilla CommNet posture), rather than an empty namespace a
            // widget would read as "RA present but silent".
            if (band == null && techLevel == null && modulationBits == null && encoder == null &&
                codingRate == null && beamwidth == null && powerDrawEc == null &&
                requiredEbN0 == null && reverseBitsPerSec == null)
            {
                return null;
            }

            return new Dictionary<string, object?>
            {
                [ProviderId] = new Dictionary<string, object?>
                {
                    ["band"] = band,
                    ["techLevel"] = techLevel,
                    ["modulationBits"] = modulationBits,
                    ["encoder"] = encoder,
                    ["codingRate"] = codingRate,
                    ["requiredEbN0"] = requiredEbN0,
                    ["beamwidth"] = beamwidth,
                    ["powerDrawEc"] = powerDrawEc,
                    ["reverseBitsPerSec"] = reverseBitsPerSec,
                },
            };
        }
    }
}
