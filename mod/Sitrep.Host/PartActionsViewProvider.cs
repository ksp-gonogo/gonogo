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
        /// the runtime Topic registry, which a prefix never can, it is not a topic
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

            /// <summary>The shaped payload this publication carries, flattened to the wire only when the change gate lets it through.</summary>
            public PartActions? Source { get; set; }

            private Dictionary<string, object?>? _payload;

            /// <summary>The already-flattened wire dictionary (see <see cref="ToWire"/>), not the POCO: what <see cref="IChannelPublisher.Publish"/> wants. Built on first read, so a part the gate holds back costs no dictionaries.</summary>
            public Dictionary<string, object?>? Payload =>
                _payload ??= Source == null ? null : ToWire(Source);

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
            string? vesselId) => Build(actuator, partIds, vesselId, null, out _);

        /// <summary>
        /// As above, stopping before the next part once <paramref name="outOfTime"/>
        /// answers true, so a caller can spread a large vessel over several ticks.
        /// <paramref name="read"/> is how many of <paramref name="partIds"/> were
        /// read, at least one when any were given.
        /// </summary>
        public static List<Publication> Build(
            IPartActionActuator actuator,
            IEnumerable<string> partIds,
            string? vesselId,
            System.Func<bool>? outOfTime,
            out int read)
        {
            var publications = new List<Publication>();
            read = 0;
            foreach (var partId in partIds)
            {
                if (read > 0 && outOfTime != null && outOfTime())
                {
                    break;
                }

                read++;
                if (string.IsNullOrEmpty(partId))
                {
                    continue;
                }

                var normalized = Normalize(actuator.List(partId));
                var payload = new PartActions
                {
                    PartId = partId,
                    Actions = normalized.Where(e => !IsGameWindow(e)).ToList(),
                    GameWindows = normalized.Where(IsGameWindow).ToList(),
                    Window = actuator.ListWindow(partId).Where(i => i != null).ToList(),
                    Meta = BuildMeta(vesselId),
                };

                publications.Add(new Publication
                {
                    SubTopic = SubTopic(partId),
                    Source = payload,
                    Signature = Signature(payload),
                });
            }

            return publications;
        }

        /// <summary>
        /// One tick of the paced walk: starts a sweep over the subscribed ids when
        /// one is due, reads as many of the remaining parts as
        /// <paramref name="outOfTime"/> allows and moves the sweep on by exactly
        /// the number read. Returns the publications to gate, and
        /// <paramref name="subscribed"/> as every id the sweep covers (what the
        /// change gate prunes against), or an empty list and null when nothing is
        /// due.
        ///
        /// <para>The sweep, not the caller, holds the cursor and the list it
        /// indexes, so the two cannot be compared across different lists.</para>
        /// </summary>
        public static List<Publication> Tick(
            IPartActionActuator actuator,
            PartActionsSweep sweep,
            System.Func<List<string>> subscribedIds,
            System.Func<string?> vesselId,
            long nowMs,
            System.Func<bool> outOfTime,
            out List<string>? subscribed)
        {
            subscribed = null;
            if (!sweep.Active)
            {
                if (!sweep.Due(nowMs))
                {
                    return new List<Publication>();
                }

                sweep.Start(subscribedIds(), nowMs);
            }

            var remaining = sweep.Remaining();
            if (remaining.Count == 0)
            {
                return new List<Publication>();
            }

            var publications = Build(actuator, remaining, vesselId(), outOfTime, out var read);
            sweep.Advance(read);
            subscribed = sweep.Ids;
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
        /// <para>Ordering is stable and not alphabetical: the actuator yields the
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
                if (!seen.Add((entry.ModuleName ?? "") + FieldSeparator + (entry.ModuleIndex?.ToString() ?? "") + FieldSeparator + entry.Name))
                {
                    continue;
                }

                entry.OpensGameWindow = InGameOnlyPartActions.OpensGameWindow(entry.Name);
                normalized.Add(entry);
            }

            return normalized;
        }

        private static bool IsGameWindow(PartActionEntry entry) =>
            InGameOnlyPartActions.IsInGameOnly(entry.Name, entry.ModuleName);

        /// <summary>
        /// A deterministic content fingerprint of one part's shaped payload, the
        /// key <see cref="PartActionsPublicationCache"/> change-gates on.
        ///
        /// <para><b>Why the producer has to gate at all.</b>
        /// <c>Sitrep.Core.ChannelEmitter</c>'s own change-gate compares values with
        /// <c>Equals</c>, which for a freshly-built
        /// <c>Dictionary&lt;string, object?&gt;</c> is reference equality: a
        /// per-tick rebuild of an identical payload would therefore look like a
        /// change every single tick and emit a keyframe every single tick. That
        /// would defeat the whole point of a near-static channel (a part's action
        /// set moves only on deploy/stage/dock), so the gate lives here, where the
        /// content is still known, rather than being wished onto the emitter.</para>
        ///
        /// <para>Every field that reaches the wire is included, so a change the
        /// operator could see can never be gated out. That is why the vessel
        /// enters via <c>meta.source</c> rather than a field of its own: the
        /// payload carries no <c>vesselId</c>, and <c>meta.source</c> is the one
        /// place the subject reaches the wire. A re-labelled button
        /// ("Deploy" becoming "Retract") and a button merely going inactive are
        /// both changes. Cheap by construction, the input is tens of short strings,
        /// and it runs once per subscribed part per tick.</para>
        /// </summary>
        public static string Signature(PartActions payload)
        {
            var sb = new StringBuilder();
            sb.Append(payload.Meta.Source).Append(FieldSeparator).Append(payload.PartId);
            foreach (var a in payload.Actions.Concat(payload.GameWindows))
            {
                sb.Append(FieldSeparator)
                  .Append(a.Name).Append(FieldSeparator)
                  .Append(a.Label).Append(FieldSeparator)
                  .Append(a.Group).Append(FieldSeparator)
                  .Append(a.ModuleName).Append(FieldSeparator)
                  .Append(a.ModuleIndex).Append(FieldSeparator)
                  .Append(a.Active ? '1' : '0')
                  .Append(a.GuiActiveUnfocused ? '1' : '0')
                  .Append(a.AdvancedTweakable ? '1' : '0')
                  .Append(a.RequireFullControl ? '1' : '0')
                  .Append(a.OpensGameWindow ? '1' : '0');
            }
            foreach (var w in payload.Window)
            {
                sb.Append(FieldSeparator).Append('w')
                  .Append(w.Kind).Append(FieldSeparator)
                  .Append(w.Module).Append(FieldSeparator)
                  .Append(w.Name).Append(FieldSeparator)
                  .Append(w.Label).Append(FieldSeparator)
                  .Append(w.Group).Append(FieldSeparator)
                  .Append(w.Kind == "resource" ? "" : w.Text).Append(FieldSeparator)
                  .Append(SignatureNumber(w)).Append(FieldSeparator)
                  .Append(w.Min?.ToString("R", System.Globalization.CultureInfo.InvariantCulture)).Append(FieldSeparator)
                  .Append(w.Max?.ToString("R", System.Globalization.CultureInfo.InvariantCulture)).Append(FieldSeparator)
                  .Append(w.Step?.ToString("R", System.Globalization.CultureInfo.InvariantCulture)).Append(FieldSeparator)
                  .Append(w.Options == null ? "" : string.Join(FieldSeparator.ToString(), w.Options)).Append(FieldSeparator)
                  .Append(w.Flows == null ? '-' : (w.Flows.Value ? '1' : '0'))
                  .Append(w.Editable ? '1' : '0')
                  .Append(w.Advanced ? '1' : '0');
            }
            return sb.ToString();
        }

        /// <summary>
        /// A resource's share of its capacity that moves the gate: below this a
        /// bar cannot be told apart, and a tank that drifts by a few thousandths
        /// (an idle craft's electric charge) would otherwise resend its whole
        /// window every second. The amount that goes out when the gate opens is
        /// the exact one.
        /// </summary>
        public const double ResourceGateShare = 0.005;

        private static string SignatureNumber(PartWindowItem row)
        {
            if (row.Kind == "resource" && row.Number.HasValue)
            {
                var step = (row.Max ?? 0) * ResourceGateShare;
                if (step > 0)
                {
                    return System.Math.Round(row.Number.Value / step)
                        .ToString("R", System.Globalization.CultureInfo.InvariantCulture);
                }
            }

            return row.Number?.ToString("R", System.Globalization.CultureInfo.InvariantCulture) ?? "";
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
            ["partId"] = payload.PartId,
            ["actions"] = payload.Actions.Select(a => (object?)ToWire(a)).ToList(),
            ["gameWindows"] = payload.GameWindows.Select(a => (object?)ToWire(a)).ToList(),
            ["window"] = payload.Window.Select(w => (object?)ToWire(w)).ToList(),
            ["meta"] = ToWire(payload.Meta),
        };

        private static Dictionary<string, object?> ToWire(PartActionEntry entry) => new Dictionary<string, object?>
        {
            ["name"] = entry.Name,
            ["label"] = entry.Label,
            ["group"] = entry.Group,
            ["moduleName"] = entry.ModuleName,
            ["moduleIndex"] = entry.ModuleIndex,
            ["active"] = entry.Active,
            ["guiActiveUnfocused"] = entry.GuiActiveUnfocused,
            ["advancedTweakable"] = entry.AdvancedTweakable,
            ["requireFullControl"] = entry.RequireFullControl,
            ["opensGameWindow"] = entry.OpensGameWindow,
        };

        private static Dictionary<string, object?> ToWire(PartWindowItem item) => new Dictionary<string, object?>
        {
            ["kind"] = item.Kind,
            ["module"] = item.Module,
            ["name"] = item.Name,
            ["label"] = item.Label,
            ["group"] = item.Group,
            ["text"] = item.Text,
            ["number"] = item.Number,
            ["min"] = item.Min,
            ["max"] = item.Max,
            ["step"] = item.Step,
            ["options"] = item.Options?.Select(o => (object?)o).ToList(),
            ["flows"] = item.Flows,
            ["advanced"] = item.Advanced,
            ["editable"] = item.Editable,
        };

        private static Dictionary<string, object?> ToWire(PayloadMeta meta) => new Dictionary<string, object?>
        {
            ["source"] = meta.Source,
        };

        /// <summary>
        /// Provenance, matching <see cref="VesselPartsViewProvider"/>'s: the
        /// subject is the vessel the part is on, carried in the prefixed
        /// <c>vessel:&lt;guid&gt;</c> form every other vessel payload's
        /// <c>meta.source</c> uses. This is the only place the payload names its
        /// vessel; the topic string carries a part id, not a vessel guid, and the
        /// per-Topic <c>vesselId</c> field is deliberately absent (the subject
        /// boundary belongs at the ledger, not repeated on every sample).
        /// </summary>
        private static PayloadMeta BuildMeta(string? vesselId) => new PayloadMeta
        {
            Source = vesselId != null ? "vessel:" + vesselId : "",
        };
    }
}
