using System;
using System.Collections.Generic;

namespace Gonogo.ScansatUplink
{
    /// <summary>Which dynamic SCANsat namespace a <see cref="ScanPublication"/> targets.</summary>
    internal enum ScanChannelKind
    {
        Coverage,
        Mask,
        Height,
        Biome,
    }

    /// <summary>One "publish this payload to this sub-topic under this namespace at this UT" instruction.</summary>
    internal readonly struct ScanPublication
    {
        public readonly ScanChannelKind Kind;
        public readonly string SubTopic;
        public readonly object? Payload;
        public readonly double Ut;

        public ScanPublication(ScanChannelKind kind, string subTopic, object? payload, double ut)
        {
            Kind = kind;
            SubTopic = subTopic;
            Payload = payload;
            Ut = ut;
        }
    }

    /// <summary>
    /// The COURIER-SIDE half of the SCANsat uplink's capture-on-main /
    /// handle-on-Courier split (see <see cref="ScanCapture"/> and
    /// <see cref="Sitrep.Contract.IUplinkHost.AddSampledSource"/>): the
    /// hashing / keyframe-on-change / packing logic that used to run inline in
    /// <c>ScansatUplink.Sample</c> off the main thread, now driven ENTIRELY by
    /// the plain <see cref="ScanCapture"/> payload the main thread already
    /// gathered. It touches ZERO KSP/Unity/SCANsat API — every input is data
    /// on the capture, every output is a <see cref="ScanPublication"/>
    /// descriptor — which is exactly why it lives in its own file and is
    /// exercised headlessly (no SCANsat/KSP DLLs) by
    /// <c>ScanPublicationsTests</c>.
    /// </summary>
    internal static class ScanPublications
    {
        /// <summary>
        /// Computes the set of channel publications for one captured sample,
        /// applying the same per-body coarse-hash gate and per-(body,type)
        /// plane-changed gate the pre-split <c>Sample</c> did.
        /// <paramref name="lastHashByBody"/> and
        /// <paramref name="lastPackedByBodyType"/> are the Courier-owned
        /// keyframe-on-change state and ARE mutated in place as new keyframes
        /// are emitted — identical semantics to the fields they replace.
        /// Height/biome are emitted once per body visit (when
        /// <see cref="ScanCapture.IncludeHeightBiome"/> is set, which the
        /// main-thread capture already gates).
        /// </summary>
        public static List<ScanPublication> Compute(
            ScanCapture cap,
            Dictionary<string, ulong> lastHashByBody,
            Dictionary<string, byte[]> lastPackedByBodyType)
        {
            var publications = new List<ScanPublication>();

            // Height/biome first — independent of SCANsat coverage (stock
            // PQS/BiomeMap), published once per body visit.
            if (cap.IncludeHeightBiome)
            {
                publications.Add(new ScanPublication(
                    ScanChannelKind.Height,
                    ScanChannels.BodySubTopic(cap.BodyName),
                    ScanGrids.BuildHeightPayload(ScanGrids.Width, ScanGrids.Height, cap.HeightGrid),
                    cap.Ut));

                publications.Add(new ScanPublication(
                    ScanChannelKind.Biome,
                    ScanChannels.BodySubTopic(cap.BodyName),
                    ScanGrids.BuildBiomePayload(
                        ScanGrids.Width,
                        ScanGrids.Height,
                        cap.BiomeEntries ?? new List<object?>(),
                        cap.BiomeIndices ?? Array.Empty<byte>()),
                    cap.Ut));
            }

            if (cap.Coverage == null || cap.CoveragePercents == null)
            {
                return publications; // no SCANdata for this body yet — no coverage/mask.
            }

            // Cheap body-level gate: skip the per-type re-pack entirely when
            // the whole coverage grid's hash is unchanged since last poll.
            var bodyChanged = CoverageHash.HasChanged(
                cap.Coverage,
                lastHashByBody.TryGetValue(cap.BodyName, out var h) ? h : (ulong?)null,
                out var newHash);
            if (!bodyChanged)
            {
                return publications;
            }
            lastHashByBody[cap.BodyName] = newHash;

            foreach (var typeBit in ScanChannels.ClientScanTypes)
            {
                var packed = CoveragePlane.Pack(cap.Coverage, typeBit);
                var key = cap.BodyName + "|" + typeBit;
                var lastPacked = lastPackedByBodyType.TryGetValue(key, out var lp) ? lp : null;
                if (!CoveragePlane.PlaneChanged(lastPacked, packed))
                {
                    continue; // this specific type's plane didn't move — another type's bits changed the body hash.
                }
                lastPackedByBodyType[key] = packed;

                var subTopic = ScanChannels.BodyTypeSubTopic(cap.BodyName, typeBit);
                var percent = cap.CoveragePercents.TryGetValue(typeBit, out var p) ? p : 0.0;

                // coverage.<body>.<type> is the SCALAR percentage; mask is the
                // full packed keyframe — matching the pre-split wire shape.
                publications.Add(new ScanPublication(ScanChannelKind.Coverage, subTopic, percent, cap.Ut));
                publications.Add(new ScanPublication(
                    ScanChannelKind.Mask,
                    subTopic,
                    ScanGrids.BuildMaskPayload(ScanGrids.Width, ScanGrids.Height, typeBit, packed),
                    cap.Ut));
            }

            return publications;
        }
    }
}
