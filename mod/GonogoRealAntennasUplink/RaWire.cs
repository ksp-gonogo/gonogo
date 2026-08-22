using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// Builds the wire shapes for this Uplink's three private channels: one
    /// <c>Dictionary&lt;string, object?&gt;</c> per payload, keyed camelCase to
    /// match the generated TS interfaces field for field.
    ///
    /// <para><b>Why this exists at all.</b> Until the wire types moved out of
    /// <c>Sitrep.Contract</c>, this Uplink published the POCOs raw and core's
    /// <c>JsonWriter</c> carried a hand-written <c>case</c> plus an
    /// <c>AppendComms*</c> helper for each of the three. Those types now live in
    /// <c>GonogoRealAntennasUplink.Contract</c>, and a core serializer may not
    /// reference an Uplink's assembly, so the flatten moved to the producer,
    /// where every other Uplink in this repository already does it. Without this
    /// step the POCOs would reach <c>AppendValue</c>'s <c>default</c> branch and
    /// throw <c>NotSupportedException</c> at the wire boundary, dropping the
    /// frame: a subscriber would get "subscribed" and then silence, the exact
    /// failure the deleted helpers' own comment records having fixed once.</para>
    ///
    /// <para><b>The output is byte-identical to what core used to write.</b> Same
    /// key order, same camelCase names, and <c>meta</c> as a nested
    /// <c>{ source, quality }</c> with quality as its integer ORDINAL rather than
    /// its name, which is the convention every enum on this wire follows
    /// (<c>JsonWriter.AppendPayloadMeta</c> is the mirror). The POCOs stay as the
    /// typing mirror the TS codegen reflects over; this is the only thing that
    /// ever reaches the Courier.</para>
    ///
    /// <para>KSP-free by construction (no RA/Unity types touched), so it is
    /// exercised headlessly: see <c>GonogoRealAntennasUplink.Tests</c>.</para>
    /// </summary>
    public static class RaWire
    {
        public static Dictionary<string, object?> LinkQuality(CommsLinkQuality q) =>
            new Dictionary<string, object?>
            {
                ["value"] = q.Value,
                ["meta"] = Meta(q.Meta),
            };

        public static Dictionary<string, object?> DataRate(CommsDataRate r) =>
            new Dictionary<string, object?>
            {
                ["upBitsPerSec"] = r.UpBitsPerSec,
                ["downBitsPerSec"] = r.DownBitsPerSec,
                ["meta"] = Meta(r.Meta),
            };

        public static Dictionary<string, object?> LinkMargin(CommsLinkMargin m) =>
            new Dictionary<string, object?>
            {
                ["decibelMargin"] = m.DecibelMargin,
                ["closesLink"] = m.ClosesLink,
                ["meta"] = Meta(m.Meta),
            };

        /// <summary>
        /// The <c>realantennas.hopRates</c> channel value: a bare ARRAY, one
        /// flattened entry per hop that has a readable forward rate. Keyed by the
        /// same node ids <c>comms.path</c> carries, so the client joins each rate
        /// onto the existing route without this Uplink republishing the topology.
        /// Empty list is a legitimate value (connected but no hop rate readable),
        /// not typed absence.
        /// </summary>
        public static List<Dictionary<string, object?>> HopRates(IReadOnlyList<RealAntennasHopRate> hops)
        {
            var list = new List<Dictionary<string, object?>>(hops.Count);
            foreach (var hop in hops)
            {
                list.Add(new Dictionary<string, object?>
                {
                    ["fromNodeId"] = hop.FromNodeId,
                    ["toNodeId"] = hop.ToNodeId,
                    ["bitsPerSec"] = hop.BitsPerSec,
                });
            }
            return list;
        }

        /// <summary>
        /// <c>{ source, quality }</c>, quality as its integer ordinal. A null
        /// meta collapses to the same defaults core's own writer used (empty
        /// source, <c>Quality.OnRails</c>), so a payload built without one keeps
        /// serializing rather than emitting a null the client has to guard.
        /// </summary>
        private static Dictionary<string, object?> Meta(PayloadMeta? meta) =>
            new Dictionary<string, object?>
            {
                ["source"] = meta?.Source ?? "",
                ["quality"] = (int)(meta?.Quality ?? Quality.OnRails),
            };
    }
}
