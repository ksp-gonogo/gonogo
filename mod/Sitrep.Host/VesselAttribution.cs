using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Reflection;

namespace Sitrep.Host
{
    /// <summary>
    /// Names the vessel a capability channel's payload describes, for the
    /// channels whose Topic name carries no guid.
    ///
    /// <para>The <c>fleet.&lt;guid&gt;</c> namespace never needed this: the guid
    /// is in the topic name, which is also the Courier node carrying that
    /// vessel's light-time. The elected-capability namespaces
    /// (<c>science.*</c>, <c>isru.*</c>, <c>reliability.*</c>) have neither.
    /// They are active-vessel reads published on ONE fixed topic name, and they
    /// are <see cref="Sitrep.Contract.DelayRole.Delayed"/>, so a delivered
    /// sample is light-time old while the client's notion of which vessel is
    /// active is whatever it holds now: after a vessel switch the cached value
    /// describes the previous ship with no in-band way to see the boundary.
    /// <see cref="VesselViewProvider.BuildIdentity"/> already states the rule
    /// that breaks (R1: an unattributable payload is worse than no payload).</para>
    ///
    /// <para><b>Attribution belongs to whoever owns the topic declaration</b>,
    /// which is the core registrar uplink, never the elected backend. A provider
    /// implements <c>IScienceBackend</c> to model science, and must not have to
    /// know that a fixed-name topic needs a subject; stamping here means every
    /// backend's samples are attributed, including one that ships in a mod
    /// written against an older SDK.</para>
    ///
    /// <para>The id is the RAW <c>Vessel.id</c> guid, byte-identical to what
    /// <c>fleet.&lt;guid&gt;</c> and <c>currency.&lt;guid&gt;.*</c> key by and
    /// to <see cref="Sitrep.Contract.VesselIdentity.VesselId"/>, with no
    /// <c>"vessel:"</c> prefix, so a consumer joins across all of them without a
    /// translation step. A second, prettier id would be the whole problem again
    /// in a new spelling.</para>
    /// </summary>
    public static class VesselAttribution
    {
        /// <summary>The wire key, and the camelCase of the <c>VesselId</c> property every attributed payload type declares.</summary>
        public const string WireKey = "vesselId";

        private static readonly ConcurrentDictionary<System.Type, PropertyInfo?> VesselIdProperties = new();

        /// <summary>
        /// The vessel THIS snapshot describes, from the same
        /// <c>Values["vessel"]["identity"]["id"]</c> read
        /// <see cref="VesselViewProvider.BuildIdentity"/> does.
        ///
        /// <para>Deliberately the snapshot rather than the live active vessel: a
        /// channel mapper runs on the Courier thread, where touching KSP is
        /// illegal, and the subject of a mapped payload is the vessel the
        /// snapshot was captured FROM, not whichever vessel happens to be active
        /// by the time the mapping runs. Those differ exactly when it matters.</para>
        ///
        /// <para>Null when there is no active vessel (no vessel group at all) or
        /// the identity carries no id: the caller writes the key with a null
        /// value rather than omitting it, matching every other optional field on
        /// these payloads, so "we do not know which vessel" is stated instead of
        /// left to inference.</para>
        /// </summary>
        public static string? VesselIdOf(Sitrep.Contract.KspSnapshot? snapshot)
        {
            if (snapshot?.Values == null)
            {
                return null;
            }

            if (!snapshot.Values.TryGetValue("vessel", out var rawVessel)
                || rawVessel is not IDictionary<string, object?> vessel)
            {
                return null;
            }

            if (!vessel.TryGetValue("identity", out var rawIdentity)
                || rawIdentity is not IDictionary<string, object?> identity)
            {
                return null;
            }

            var id = SnapshotDict.GetString(identity, "id");
            return string.IsNullOrEmpty(id) ? null : id;
        }

        /// <summary>
        /// Stamps <paramref name="vesselId"/> onto an elected backend's payload
        /// and returns it. Handles both shapes a backend can hand back: a list of
        /// <c>Dictionary&lt;string, object?&gt;</c> entries (what every in-tree
        /// backend builds) and a list of contract POCOs (what a typed provider
        /// may build), plus a single one of either. Anything else passes through
        /// untouched rather than throwing: a channel must not go dark because
        /// attribution could not find a place to write.
        ///
        /// <para>The key is written unconditionally, null included, because these
        /// are array Topics with no enclosing object to hold one copy: giving
        /// them one would retype the channel rather than add to it, so the id
        /// repeats per entry, the same call every other array-shaped attributed
        /// payload in the contract makes.</para>
        /// </summary>
        public static object? Stamp(object? payload, string? vesselId)
        {
            switch (payload)
            {
                case null:
                    return null;
                case IDictionary<string, object?> entry:
                    entry[WireKey] = vesselId;
                    return payload;
                case string:
                    return payload;
                case IEnumerable list:
                    foreach (var item in list)
                    {
                        StampEntry(item, vesselId);
                    }
                    return payload;
                default:
                    StampEntry(payload, vesselId);
                    return payload;
            }
        }

        private static void StampEntry(object? entry, string? vesselId)
        {
            if (entry == null)
            {
                return;
            }

            if (entry is IDictionary<string, object?> dictionary)
            {
                dictionary[WireKey] = vesselId;
                return;
            }

            // A typed provider's POCO. Cached per type: this runs once per entry
            // per flush, and a reflection lookup per entry per flush is the kind
            // of cost that only shows up on a 200-part vessel.
            var property = VesselIdProperties.GetOrAdd(
                entry.GetType(),
                type => type.GetProperty("VesselId", BindingFlags.Public | BindingFlags.Instance) is { } candidate
                        && candidate.CanWrite
                        && candidate.PropertyType == typeof(string)
                    ? candidate
                    : null);

            property?.SetValue(entry, vesselId);
        }
    }
}
