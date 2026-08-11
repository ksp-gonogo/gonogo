using System.Collections.Generic;
using System.Linq;
using System.Text;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free half of the PAW part-actions surface: it owns the
    /// <c>vessel.partActions.&lt;flightId&gt;</c> topic namespace, turns the raw
    /// per-part event lists an <see cref="IPartActionActuator"/> reads out of KSP
    /// into stable, deduplicated <see cref="PartActions"/> payloads, and flattens
    /// those to the wire. The read-side twin of
    /// <see cref="PartActionCommandProvider"/>, and the PAW analogue of
    /// <see cref="VesselPartsViewProvider"/>.
    ///
    /// <para><b>Why the dedup and ordering live here rather than in the KSP
    /// actuator:</b> they are the parts worth testing, and they are pure. The
    /// actuator's job is the one thing only KSP can do (walk <c>part.Events</c>
    /// plus each <c>PartModule.Events</c>); everything downstream of that list is
    /// exercised headlessly against
    /// <c>Sitrep.Host.Tests.FakePartActionActuator</c>.</para>
    ///
    /// <para><b>Subscription-gated by construction.</b> <see cref="Build"/> takes
    /// the part ids to enumerate rather than discovering them, so the caller
    /// (<c>Gonogo.KSP.VesselUplink</c>) passes only the parts a client is
    /// actually subscribed to. Nothing open means an empty list in, no
    /// <see cref="IPartActionActuator.List"/> calls, and no publications out:
    /// that is what keeps a 200-part vessel from costing anything while no
    /// operator has a part open. See <see cref="PartActions"/>'s doc comment for
    /// why this is a per-part namespace instead of a field on
    /// <c>vessel.parts</c>.</para>
    /// </summary>
    public static class PartActionsViewProvider
    {
        /// <summary>
        /// The dynamic namespace every per-part action channel hangs under. A
        /// concrete topic is this plus the part's <c>flightID.ToString()</c>, so
        /// <c>vessel.partActions.1234567</c>. Registered via
        /// <see cref="IUplinkHost.RegisterDynamicNamespace"/>; the trailing dot is
        /// part of the prefix, matching the mod's other dynamic namespaces.
        ///
        /// <para><b>Deliberately not named <c>*Topic*</c></b>, and do not rename it
        /// to that: the C#-to-registry Topic sync gate
        /// (<c>packages/app/src/__tests__/topic-cs-sync.test.ts</c>) scrapes
        /// <c>const string *Topic* = "..."</c> and would then demand this appear in
        /// the runtime Topic registry, which a PREFIX never can, it is not a topic
        /// id. Every other dynamic namespace in the mod is named <c>*Prefix</c> for
        /// exactly this reason.</para>
        /// </summary>
        public const string PartActionsPrefix = "vessel.partActions.";

        /// <summary>The concrete channel topic for one part: <see cref="PartActionsPrefix"/> + <paramref name="partId"/>.</summary>
        public static string Topic(string partId) => PartActionsPrefix + partId;

        /// <summary>
        /// The sub-topic to hand <see cref="IDynamicChannelSource.Publisher"/>:
        /// the part id alone, since the prefix is already the namespace's.
        /// </summary>
        public static string SubTopic(string partId) => partId;

        /// <summary>
        /// One part's actions, shaped and ready to publish. Carries its own
        /// sub-topic so the caller does not have to re-derive it, mirroring the
        /// publication-record shape the mod's other dynamic producers use.
        /// </summary>
        public sealed class Publication
        {
            public string SubTopic { get; set; } = "";

            /// <summary>The already-flattened wire dictionary (see <see cref="ToWire"/>), not the POCO: what <see cref="IChannelPublisher.Publish"/> wants.</summary>
            public Dictionary<string, object?>? Payload { get; set; }

            /// <summary>
            /// Content fingerprint of <see cref="Payload"/> (see
            /// <see cref="PartActionsViewProvider.Signature"/>), the change-gate key
            /// <see cref="PartActionsPublicationCache"/> compares on. Carried on the
            /// publication rather than recomputed later so it is derived from the
            /// same shaped data that is about to go out, never from a second read.
            /// </summary>
            public string Signature { get; set; } = "";
        }

        /// <summary>
        /// Enumerate + shape the actions for each of <paramref name="partIds"/>.
        /// One <see cref="Publication"/> per id, in the order given, so a caller
        /// publishing them preserves the vessel's own part order.
        ///
        /// <para>MAIN-THREAD: <paramref name="actuator"/> reads live KSP state, so
        /// this runs in the capture half of
        /// <see cref="IUplinkHost.AddSampledSource"/>. The flatten it produces is
        /// plain data, safe to carry to the Courier thread and publish there.</para>
        /// </summary>
        public static List<Publication> Build(
            IPartActionActuator actuator,
            IEnumerable<string> partIds,
            string? vesselId)
        {
            var publications = new List<Publication>();
            foreach (var partId in partIds)
            {
                if (string.IsNullOrEmpty(partId))
                {
                    continue;
                }

                var payload = new PartActions
                {
                    VesselId = vesselId,
                    PartId = partId,
                    Actions = Normalize(actuator.List(partId)),
                    Meta = BuildMeta(vesselId),
                };

                publications.Add(new Publication
                {
                    SubTopic = SubTopic(partId),
                    Payload = ToWire(payload),
                    Signature = Signature(payload),
                });
            }

            return publications;
        }

        /// <summary>
        /// Deduplicate and order one part's raw event list.
        ///
        /// <para><b>Dedup by (module, name), not by name alone.</b> The
        /// investigation this was built from flagged an open question it could not
        /// settle statically: whether <c>part.Events</c> already aggregates its
        /// modules' events or has to be unioned manually. Deduplicating on the
        /// pair makes the answer stop mattering: if KSP aggregates, the duplicate
        /// collapses; if it does not, the union is complete. Two genuinely
        /// different modules exposing the same event name (two identical
        /// deployable modules on one part) stay separate, which is correct, they
        /// are separate buttons in the real PAW.</para>
        ///
        /// <para>Ordering is stable and NOT alphabetical: the actuator yields the
        /// part's own events before its modules', in module order, which is the
        /// order KSP itself builds the window in. Re-sorting would make the
        /// operator's list disagree with the game's for no gain. Ties are
        /// impossible after the dedup, so no tiebreak is needed.</para>
        /// </summary>
        private static List<PartActionEntry> Normalize(IReadOnlyList<PartActionEntry>? entries)
        {
            var normalized = new List<PartActionEntry>();
            if (entries == null)
            {
                return normalized;
            }

            var seen = new HashSet<string>();
            foreach (var entry in entries)
            {
                if (entry == null || string.IsNullOrEmpty(entry.Name))
                {
                    // An event with no name is uninvokable: the name IS the
                    // invoke key, so carrying it would render a button that
                    // cannot be fired.
                    continue;
                }

                // Separated by the same control character Signature uses, so
                // two distinct (module, name) pairs can never concatenate into
                // a single key.
                if (!seen.Add((entry.ModuleName ?? "") + FieldSeparator + entry.Name))
                {
                    continue;
                }

                normalized.Add(entry);
            }

            return normalized;
        }

        /// <summary>
        /// A deterministic content fingerprint of one part's shaped payload, the
        /// key <see cref="PartActionsPublicationCache"/> change-gates on.
        ///
        /// <para><b>Why the producer has to gate at all.</b>
        /// <c>Sitrep.Core.ChannelEmitter</c>'s own change-gate compares values with
        /// <c>Equals</c>, which for a freshly-built
        /// <c>Dictionary&lt;string, object?&gt;</c> is REFERENCE equality: a
        /// per-tick rebuild of an identical payload would therefore look like a
        /// change every single tick and emit a keyframe every single tick. That
        /// would defeat the whole point of a near-static channel (a part's action
        /// set moves only on deploy/stage/dock), so the gate lives here, where the
        /// content is still known, rather than being wished onto the emitter.</para>
        ///
        /// <para>Every field that reaches the wire is included, so a change the
        /// operator could see can never be gated out: a re-labelled button
        /// ("Deploy" becoming "Retract") and a button merely going inactive are
        /// both changes. Cheap by construction, the input is tens of short strings,
        /// and it runs once per subscribed part per tick.</para>
        /// </summary>
        public static string Signature(PartActions payload)
        {
            var sb = new StringBuilder();
            sb.Append(payload.VesselId).Append(FieldSeparator).Append(payload.PartId);
            foreach (var a in payload.Actions)
            {
                sb.Append(FieldSeparator)
                  .Append(a.Name).Append(FieldSeparator)
                  .Append(a.Label).Append(FieldSeparator)
                  .Append(a.Group).Append(FieldSeparator)
                  .Append(a.ModuleName).Append(FieldSeparator)
                  .Append(a.Active ? '1' : '0')
                  .Append(a.GuiActiveUnfocused ? '1' : '0')
                  .Append(a.AdvancedTweakable ? '1' : '0')
                  .Append(a.RequireFullControl ? '1' : '0');
            }
            return sb.ToString();
        }

        /// <summary>
        /// ASCII unit separator: a control character no KSP identifier, localized
        /// label or PAW group name can contain, so two different action lists can
        /// never flatten to the same signature by concatenation (the classic
        /// "ab|c" versus "a|bc" collision a printable delimiter allows).
        /// </summary>
        private const char FieldSeparator = (char)31;

        /// <summary>
        /// Flattens <see cref="PartActions"/> to the wire dictionary, the
        /// "producer owns the flatten" boundary (see
        /// <c>Sitrep.Core.Tests.WirePayloadCoverageTests</c>): a raw POCO handed to
        /// <c>JsonWriter.AppendValue</c> with no case for it throws at the wire
        /// boundary and the frame is silently dropped, so this type never reaches
        /// the writer un-flattened. Keys are the camelCase of each property, the
        /// same mapping <c>RtConfig.CamelCaseForProperties</c> gives the generated
        /// TS shape.
        /// </summary>
        public static Dictionary<string, object?> ToWire(PartActions payload) => new Dictionary<string, object?>
        {
            ["vesselId"] = payload.VesselId,
            ["partId"] = payload.PartId,
            ["actions"] = payload.Actions.Select(a => (object?)ToWire(a)).ToList(),
            ["meta"] = ToWire(payload.Meta),
        };

        private static Dictionary<string, object?> ToWire(PartActionEntry entry) => new Dictionary<string, object?>
        {
            ["name"] = entry.Name,
            ["label"] = entry.Label,
            ["group"] = entry.Group,
            ["moduleName"] = entry.ModuleName,
            ["active"] = entry.Active,
            ["guiActiveUnfocused"] = entry.GuiActiveUnfocused,
            ["advancedTweakable"] = entry.AdvancedTweakable,
            ["requireFullControl"] = entry.RequireFullControl,
        };

        private static Dictionary<string, object?> ToWire(PayloadMeta meta) => new Dictionary<string, object?>
        {
            ["source"] = meta.Source,
            ["quality"] = (int)meta.Quality,
        };

        /// <summary>
        /// Provenance, matching <see cref="VesselPartsViewProvider"/>'s: the
        /// subject is the vessel the part is on. <see cref="PartActions.VesselId"/>
        /// carries the raw guid for joining (see its doc comment); this carries the
        /// prefixed <c>vessel:&lt;guid&gt;</c> form every other vessel payload's
        /// <c>meta.source</c> uses, so both conventions stay intact rather than one
        /// being bent to serve the other.
        /// </summary>
        private static PayloadMeta BuildMeta(string? vesselId) => new PayloadMeta
        {
            Source = vesselId != null ? "vessel:" + vesselId : "",
            Quality = Quality.OnRails,
        };
    }
}
