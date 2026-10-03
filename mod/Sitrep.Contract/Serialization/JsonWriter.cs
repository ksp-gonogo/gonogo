using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Sitrep.Contract.Serialization
{
    /// <summary>
    /// Hand-written, allocation-conscious JSON writer. No Json.NET and no
    /// System.Text.Json: the latter is a separate NuGet package on
    /// <c>netstandard2.0</c> and would break <c>Sitrep.Core</c>'s
    /// zero-PackageReference invariant (see <c>Sitrep.Core.csproj</c>).
    /// Writes directly into a caller-supplied <see cref="StringBuilder"/> so
    /// a full envelope write is one buffer, not one allocation per field.
    /// <c>EnvelopeCodec</c> owns fixed-schema field order and optional-field
    /// omission; this class only knows how to append JSON primitives and the
    /// fully-generic <c>object?</c> value tree (used for <c>Payload</c> /
    /// <c>Args</c> / <c>Result</c>).
    /// </summary>
    internal static class JsonWriter
    {
        /// <summary>
        /// The only place a <see cref="double"/> is ever appended; see
        /// <see cref="NanPolicy"/> for why. Finite values are written as a
        /// plain JSON number (shortest round-trippable form, matching what
        /// <c>JSON.stringify</c> produces for ordinary telemetry-range
        /// magnitudes); non-finite values are written as one of the three
        /// fixed sentinel strings instead.
        /// </summary>
        public static void AppendNumber(StringBuilder sb, double value)
        {
            var sentinel = NanPolicy.TryEncode(value);
            if (sentinel != null)
            {
                AppendString(sb, sentinel);
                return;
            }

            sb.Append(FormatFiniteNumber(value));
        }

        /// <summary>Appends a JSON integer (used for <c>Meta.Seq</c> and enum ordinals); always finite, no sentinel policy applies.</summary>
        public static void AppendInteger(StringBuilder sb, long value)
        {
            sb.Append(value.ToString(CultureInfo.InvariantCulture));
        }

        /// <summary>Appends <c>true</c> or <c>false</c>.</summary>
        public static void AppendBool(StringBuilder sb, bool value)
        {
            sb.Append(value ? "true" : "false");
        }

        /// <summary>Appends <c>null</c>.</summary>
        public static void AppendNull(StringBuilder sb)
        {
            sb.Append("null");
        }

        /// <summary>Appends a JSON string with standard escaping (quote, backslash, control chars). Non-ASCII passes through unescaped, matching <c>JSON.stringify</c>'s default.</summary>
        public static void AppendString(StringBuilder sb, string value)
        {
            sb.Append('"');
            foreach (var c in value)
            {
                switch (c)
                {
                    case '"':
                        sb.Append("\\\"");
                        break;
                    case '\\':
                        sb.Append("\\\\");
                        break;
                    case '\b':
                        sb.Append("\\b");
                        break;
                    case '\f':
                        sb.Append("\\f");
                        break;
                    case '\n':
                        sb.Append("\\n");
                        break;
                    case '\r':
                        sb.Append("\\r");
                        break;
                    case '\t':
                        sb.Append("\\t");
                        break;
                    default:
                        if (c < 0x20)
                        {
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }

        /// <summary>
        /// Generic recursive writer for the free-form CLR value shapes used
        /// by <c>Payload</c> / <c>Args</c> / <c>Result</c>: <c>null</c>,
        /// <c>bool</c>, <c>double</c> (also accepts boxed <c>int</c>/<c>long</c>/
        /// <c>float</c> for caller convenience), <c>string</c>,
        /// <c>Dictionary&lt;string, object?&gt;</c>, and <c>List&lt;object?&gt;</c>,
        /// the same shape <c>CourierGoldenFixtureTests.ToClrValue</c> uses.
        /// Numbers always go through <see cref="AppendNumber"/>, so the
        /// NaN/Infinity policy applies however deeply nested the value is.
        ///
        /// <para>Numeric types: a channel mapper is Uplink-authored and can hand
        /// back any numeric CLR type <c>ChannelEmitter.TryToDouble</c> accepts
        /// for its deadband gate (<c>short</c>, <c>sbyte</c>, <c>byte</c>,
        /// <c>uint</c>, <c>ulong</c>, <c>decimal</c> as well as <c>double</c>,
        /// <c>float</c>, <c>int</c>, <c>long</c>). Each is widened to
        /// <c>double</c>, matching the emitter's own conversion.</para>
        ///
        /// <para>Enums: a boxed enum is written as its integer ordinal, like every
        /// declared enum in this codec. It needs its own case because a boxed
        /// enum's runtime type is the enum type, so it matches no numeric
        /// case.</para>
        ///
        /// <para>Arrays: any other <see cref="IEnumerable"/> (<c>double[]</c>,
        /// <c>object?[]</c>, <c>float[]</c>) is written as a JSON array, each
        /// element back through this method, so numeric elements keep the
        /// sentinel policy and nested values recurse. That case is last among
        /// the collection cases because <c>string</c> and
        /// <c>IDictionary&lt;,&gt;</c> are themselves <c>IEnumerable</c> and must
        /// match their own cases first.</para>
        ///
        /// <para>A contract POCO needs its own case below whenever a producer
        /// publishes it raw rather than flattening it to a dictionary first:
        /// without one it reaches the <c>default</c> branch, throws
        /// <c>NotSupportedException</c> at the wire boundary, and the frame is
        /// dropped. An empty list of such POCOs serializes without a case, so
        /// only a populated payload shows the gap.</para>
        /// </summary>
        public static void AppendValue(StringBuilder sb, object? value)
        {
            switch (value)
            {
                case null:
                    AppendNull(sb);
                    break;
                case bool b:
                    AppendBool(sb, b);
                    break;
                case double d:
                    AppendNumber(sb, d);
                    break;
                case float f:
                    AppendNumber(sb, f);
                    break;
                case int i:
                    AppendNumber(sb, i);
                    break;
                case long l:
                    AppendNumber(sb, l);
                    break;
                case short s16:
                    AppendNumber(sb, s16);
                    break;
                case sbyte i8:
                    AppendNumber(sb, i8);
                    break;
                case byte u8:
                    AppendNumber(sb, u8);
                    break;
                case uint u32:
                    AppendNumber(sb, u32);
                    break;
                case ulong u64:
                    AppendNumber(sb, u64);
                    break;
                case decimal dec:
                    AppendNumber(sb, (double)dec);
                    break;
                case System.Enum e:
                    /*
                     * A boxed enum's runtime type is the enum type, not Int32, so `case int` never
                     * matches it. Convert.ToInt64 covers every underlying integral type, and a
                     * ulong-backed ordinal is read back through the unchecked cast.
                     */
                    AppendInteger(sb, e.GetTypeCode() == System.TypeCode.UInt64
                        ? unchecked((long)System.Convert.ToUInt64(e, CultureInfo.InvariantCulture))
                        : System.Convert.ToInt64(e, CultureInfo.InvariantCulture));
                    break;
                case string s:
                    AppendString(sb, s);
                    break;
                case Sitrep.Contract.CommandResult commandResult:
                    AppendCommandResult(sb, commandResult);
                    break;
                case Sitrep.Contract.CommsDelay commsDelay:
                    AppendCommsDelay(sb, commsDelay);
                    break;
                case Sitrep.Contract.VesselInventory vesselInventory:
                    AppendVesselInventory(sb, vesselInventory);
                    break;
                case Sitrep.Contract.InventoryStore inventoryStore:
                    AppendInventoryStore(sb, inventoryStore);
                    break;
                case Sitrep.Contract.InventoryItem inventoryItem:
                    AppendInventoryItem(sb, inventoryItem);
                    break;
                // No case for the scripting Uplink's wire types: they flatten producer-side (see WirePayloadCoverageTests.FlattenedByProducer).
                case Sitrep.Contract.ScetAlarm scetAlarm:
                    // alarm.scet is a bare array of these, published raw, so each element reaches here through the IEnumerable case.
                    AppendScetAlarm(sb, scetAlarm);
                    break;
                case Sitrep.Contract.ScetAlarmCondition scetAlarmCondition:
                    // Reached nested inside a roster row, and on its own for
                    // anything that publishes a condition without the row.
                    AppendScetAlarmCondition(sb, scetAlarmCondition);
                    break;
                case Sitrep.Contract.ScetAlarmAction scetAlarmAction:
                    // Reached nested inside a roster row's onFire list.
                    AppendScetAlarmAction(sb, scetAlarmAction);
                    break;
                case Sitrep.Contract.ScetAlarmFired scetAlarmFired:
                    AppendScetAlarmFired(sb, scetAlarmFired);
                    break;
                case Sitrep.Contract.ScetAddressableTopic scetAddressableTopic:
                    // alarm.scet.topics is a bare array of these, so each element reaches here through the IEnumerable case.
                    AppendScetAddressableTopic(sb, scetAddressableTopic);
                    break;
                case Sitrep.Contract.GateVerdict verdict:
                    AppendGateVerdict(sb, verdict);
                    break;
                case Sitrep.Contract.LimitBreach breachValue:
                    // Reachable on its own, not only nested in a verdict: a
                    // readout that wants the comparison without the outcome.
                    AppendLimitBreach(sb, breachValue);
                    break;
                case Sitrep.Contract.CommsLink link:
                    AppendCommsLink(sb, link);
                    break;
                case Sitrep.Contract.CommsCommandCentre commandCentre:
                    AppendCommsCommandCentre(sb, commandCentre);
                    break;
                case Sitrep.Contract.CommandCentreSeparation separation:
                    AppendCommandCentreSeparation(sb, separation);
                    break;
                case Sitrep.Contract.CentreSeparationEntry separationEntry:
                    AppendCentreSeparationEntry(sb, separationEntry);
                    break;
                case Sitrep.Contract.CommandCentreActiveVesselDelay activeVesselDelay:
                    AppendCommandCentreActiveVesselDelay(sb, activeVesselDelay);
                    break;
                case Sitrep.Contract.CentreDelayEntry centreDelayEntry:
                    AppendCentreDelayEntry(sb, centreDelayEntry);
                    break;
                case Sitrep.Contract.CommandCentreEntry centreEntry:
                    // commandCentre.roster is a bare List<CommandCentreEntry> published raw, so each element reaches here through the IEnumerable case.
                    AppendCommandCentreEntry(sb, centreEntry);
                    break;
                case Sitrep.Contract.UnreachableCentreEntry unreachableCentre:
                    // commandCentre.unreachable is a bare list published raw, like the roster.
                    AppendUnreachableCentreEntry(sb, unreachableCentre);
                    break;
                case Sitrep.Contract.CommsConnectivity connectivity:
                    AppendCommsConnectivity(sb, connectivity);
                    break;
                case Sitrep.Contract.CommsSignal signal:
                    AppendCommsSignal(sb, signal);
                    break;
                case Sitrep.Contract.CommsControl control:
                    AppendCommsControl(sb, control);
                    break;
                case Sitrep.Contract.CommsPath path:
                    AppendCommsPath(sb, path);
                    break;
                case Sitrep.Contract.CommsHop hop:
                    // Reached element-by-element when a CommsPath's Hops list is
                    // walked (AppendCommsPath -> AppendHop directly), but also
                    // handled here so a bare hop routed through AppendValue (e.g.
                    // a hand-built list) flattens rather than throwing.
                    AppendCommsHop(sb, hop);
                    break;
                case Sitrep.Contract.CommsNetwork network:
                    AppendCommsNetwork(sb, network);
                    break;
                case Sitrep.Contract.CommsNetworkNode node:
                    AppendCommsNetworkNode(sb, node);
                    break;
                case Sitrep.Contract.CommsNetworkEdge edge:
                    AppendCommsNetworkEdge(sb, edge);
                    break;
                case Sitrep.Contract.CommsOcclusion occlusion:
                    AppendCommsOcclusion(sb, occlusion);
                    break;
                case Sitrep.Contract.CommsDegrade degrade:
                    AppendCommsDegrade(sb, degrade);
                    break;
                case Sitrep.Contract.CommsOcclusionBody occlusionBody:
                    // Reached element-by-element from AppendCommsOcclusion's own
                    // loop, and handled here too so a bare entry routed through
                    // AppendValue flattens rather than throwing, same as CommsHop.
                    AppendCommsOcclusionBody(sb, occlusionBody);
                    break;
                /*
                 * No case for comms.linkQuality, comms.dataRate or comms.linkMargin: their types live in
                 * an Uplink's own contract, which a core serializer may not reference, so the producer
                 * flattens them to a dictionary before Publish.
                 */
                case Sitrep.Contract.FlightCurrent flightCurrent:
                    AppendFlightCurrent(sb, flightCurrent);
                    break;
                case Sitrep.Contract.FlightStarted flightStarted:
                    AppendFlightStarted(sb, flightStarted);
                    break;
                case Sitrep.Contract.FlightEnded flightEnded:
                    AppendFlightEnded(sb, flightEnded);
                    break;
                case Sitrep.Contract.FlightVesselChanged flightVesselChanged:
                    AppendFlightVesselChanged(sb, flightVesselChanged);
                    break;
                case Sitrep.Contract.PendingUplinkQueue pendingUplinkQueue:
                    AppendPendingUplinkQueue(sb, pendingUplinkQueue);
                    break;
                case Sitrep.Contract.CommandGateReport commandGateReport:
                    AppendCommandGateReport(sb, commandGateReport);
                    break;
                case Sitrep.Contract.CommandGate commandGate:
                    AppendCommandGate(sb, commandGate);
                    break;
                case Sitrep.Contract.CommandGateItem commandGateItem:
                    AppendCommandGateItem(sb, commandGateItem);
                    break;
                case Sitrep.Contract.ChannelGate channelGate:
                    AppendChannelGate(sb, channelGate);
                    break;
                case Sitrep.Contract.MissingUnlock missingUnlock:
                    AppendMissingUnlock(sb, missingUnlock);
                    break;
                case Sitrep.Contract.ChannelEmissionReport channelEmissionReport:
                    AppendChannelEmissionReport(sb, channelEmissionReport);
                    break;
                case Sitrep.Contract.ChannelEmissionEntry channelEmissionEntry:
                    AppendChannelEmissionEntry(sb, channelEmissionEntry);
                    break;
                case Sitrep.Contract.ScienceTransmission scienceTransmission:
                    // science.experiment.transmit's reply payload, inside CommandResult<ScienceTransmission>.Payload.
                    AppendScienceTransmission(sb, scienceTransmission);
                    break;
                case Sitrep.Contract.IsruDrillEntry isruDrillEntry:
                    // isru.drills and isru.converters publish their lists raw; a converter's recipe flows nest one level deeper.
                    AppendIsruDrillEntry(sb, isruDrillEntry);
                    break;
                case Sitrep.Contract.IsruConverterEntry isruConverterEntry:
                    AppendIsruConverterEntry(sb, isruConverterEntry);
                    break;
                case Sitrep.Contract.IsruResourceFlow isruResourceFlow:
                    AppendIsruResourceFlow(sb, isruResourceFlow);
                    break;
                case IDictionary<string, object?> obj:
                    AppendObject(sb, obj);
                    break;
                case IEnumerable enumerable:
                    AppendArray(sb, enumerable);
                    break;
                default:
                    throw new System.NotSupportedException(
                        $"JsonWriter.AppendValue: unsupported CLR value type {value.GetType()}");
            }
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.CommandResult"/> (or its
        /// generic <c>CommandResult&lt;T&gt;</c> subtype) to the wire object
        /// <c>{ success, [errorCode], [reason], [breach], [payload] }</c>. <c>breach</c> is
        /// present only on a refusal that carries a comparison (see
        /// <see cref="Sitrep.Contract.CommandResult.Breach"/>), and <c>errorCode</c>
        /// only on a refusal (see <see cref="AppendRefusalCode"/>). The <c>payload</c> key is emitted only for the
        /// generic subtype (read reflectively because <c>T</c> is open here)
        /// so a plain <see cref="Sitrep.Contract.CommandResult"/> (the "no
        /// payload" actuation ack) serializes without a payload key at all.
        /// A null payload on a <c>CommandResult&lt;T&gt;</c> (the failure
        /// case) is still a real value and is written as JSON <c>null</c>,
        /// via <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendCommandResult(StringBuilder sb, Sitrep.Contract.CommandResult result)
        {
            sb.Append('{');
            AppendString(sb, "success");
            sb.Append(':');
            AppendBool(sb, result.Success);

            AppendRefusalCode(sb, result.ErrorCode);

            // Only on a refusal that has numbers. A success carrying a null
            // breach key would put the shape on every ack for nothing, and a
            // breach of zeroes would render as a real limit of 0, the same
            // reason AppendGateVerdict keeps its own null strictly meaningful.
            if (result.Breach != null)
            {
                sb.Append(',');
                AppendString(sb, "breach");
                sb.Append(':');
                AppendLimitBreach(sb, result.Breach);
            }

            // Same rule as breach: only when the refusal actually quotes the
            // game. An empty detail key on every ack would put the shape on the
            // wire for nothing, and an empty string reads as a sentence that
            // came back blank rather than as a refusal that quoted nothing.
            if (!string.IsNullOrEmpty(result.Detail))
            {
                sb.Append(',');
                AppendString(sb, "detail");
                sb.Append(':');
                AppendString(sb, result.Detail!);
            }

            var type = result.GetType();
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Sitrep.Contract.CommandResult<>))
            {
                var payload = type.GetProperty("Payload")!.GetValue(result);
                sb.Append(',');
                AppendString(sb, "payload");
                sb.Append(':');
                AppendValue(sb, payload);
            }

            sb.Append('}');
        }

        /// <summary>
        /// A refusal as its root's id in <c>errorCode</c> and, for a refinement,
        /// its own id in <c>reason</c>. Neither key is written when there is no
        /// refusal: a success has no code, not a zero one.
        /// </summary>
        private static void AppendRefusalCode(StringBuilder sb, Sitrep.Contract.RefusalCode? code)
        {
            if (code is null) return;
            sb.Append(',');
            AppendString(sb, "errorCode");
            sb.Append(':');
            AppendString(sb, code.Root.Id);
            if (code.IsRoot) return;
            sb.Append(',');
            AppendString(sb, "reason");
            sb.Append(':');
            AppendString(sb, code.Id);
        }

        /// <summary>
        /// A gate verdict as <c>{ outcome, [errorCode], [reason], breach, detail, [missing] }</c>,
        /// the outcome as its integer ordinal like every enum sibling here.
        /// </summary>
        ///
        /// <remarks>
        /// <c>breach</c> is null for every outcome except a numeric Fail, and
        /// that is the shape the client keys on: an Abstain or an Unknown has
        /// nothing to compare, so it must not arrive carrying zeroes that render
        /// as a real limit of 0.
        /// </remarks>
        private static void AppendGateVerdict(StringBuilder sb, Sitrep.Contract.GateVerdict verdict)
        {
            sb.Append('{');
            AppendString(sb, "outcome");
            sb.Append(':');
            AppendInteger(sb, (long)verdict.Outcome);

            AppendRefusalCode(sb, verdict.ErrorCode);

            sb.Append(',');
            AppendString(sb, "breach");
            sb.Append(':');
            if (verdict.Breach == null)
            {
                AppendNull(sb);
            }
            else
            {
                AppendLimitBreach(sb, verdict.Breach);
            }

            sb.Append(',');
            AppendString(sb, "detail");
            sb.Append(':');
            AppendString(sb, verdict.Detail ?? "");

            // Omitted when absent, as its [SitrepOmittedWhenNull] declares: only a refusal that names its unlock carries one.
            if (verdict.Missing != null && verdict.Missing.Count > 0)
            {
                sb.Append(',');
                AppendString(sb, "missing");
                sb.Append(':');
                sb.Append('[');
                for (var i = 0; i < verdict.Missing.Count; i++)
                {
                    if (i > 0)
                    {
                        sb.Append(',');
                    }
                    AppendMissingUnlock(sb, verdict.Missing[i]);
                }
                sb.Append(']');
            }
            sb.Append('}');
        }

        /// <summary>
        /// A missing unlock as <c>{ kind, id, name, [tier], [scienceCost] }</c>,
        /// the kind as its integer ordinal; a building carries its tier and a
        /// tech node its cost, each omitted on the other.
        /// </summary>
        private static void AppendMissingUnlock(StringBuilder sb, Sitrep.Contract.MissingUnlock unlock)
        {
            sb.Append('{');
            AppendString(sb, "kind");
            sb.Append(':');
            AppendInteger(sb, (long)unlock.Kind);
            sb.Append(',');
            AppendString(sb, "id");
            sb.Append(':');
            AppendString(sb, unlock.Id ?? "");
            sb.Append(',');
            AppendString(sb, "name");
            sb.Append(':');
            AppendString(sb, unlock.Name ?? "");
            if (unlock.Tier.HasValue)
            {
                sb.Append(',');
                AppendString(sb, "tier");
                sb.Append(':');
                AppendInteger(sb, unlock.Tier.Value);
            }
            if (unlock.ScienceCost.HasValue)
            {
                sb.Append(',');
                AppendString(sb, "scienceCost");
                sb.Append(':');
                AppendNumber(sb, unlock.ScienceCost.Value);
            }
            sb.Append('}');
        }

        /// <summary>
        /// A limit breach as <c>{ facility, facilityName, facilityLevel,
        /// quantity, limit, actual, unit }</c>.
        /// </summary>
        ///
        /// <remarks>
        /// <c>limit</c> and <c>actual</c> are nullable and are written as null
        /// when absent rather than as 0. An unlimited facility has NO limit, and
        /// KSP says so with <c>float.MaxValue</c>, which must not reach the wire:
        /// 3.4e38 beside a craft mass is not "unlimited", it is a bug that reads
        /// as a units error. Collapsing either to 0 would be worse again, since 0
        /// is a plausible limit.
        /// </remarks>
        private static void AppendLimitBreach(StringBuilder sb, Sitrep.Contract.LimitBreach breach)
        {
            sb.Append('{');
            AppendString(sb, "facility");
            sb.Append(':');
            AppendString(sb, breach.Facility ?? "");

            sb.Append(',');
            AppendString(sb, "facilityName");
            sb.Append(':');
            AppendString(sb, breach.FacilityName ?? "");

            sb.Append(',');
            AppendString(sb, "facilityLevel");
            sb.Append(':');
            AppendNumber(sb, breach.FacilityLevel);

            sb.Append(',');
            AppendString(sb, "quantity");
            sb.Append(':');
            AppendString(sb, breach.Quantity ?? "");

            sb.Append(',');
            AppendString(sb, "limit");
            sb.Append(':');
            if (breach.Limit.HasValue) AppendNumber(sb, breach.Limit.Value); else AppendNull(sb);

            sb.Append(',');
            AppendString(sb, "actual");
            sb.Append(':');
            if (breach.Actual.HasValue) AppendNumber(sb, breach.Actual.Value); else AppendNull(sb);

            sb.Append(',');
            AppendString(sb, "unit");
            sb.Append(':');
            AppendString(sb, breach.Unit ?? "");
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.CommsDelay"/> to the wire
        /// object <c>{ oneWaySeconds, source, meta:{ source } }</c>.
        /// <c>oneWaySeconds</c> is written as JSON <c>null</c> when there is no
        /// measurable path (see <see cref="Sitrep.Contract.CommsDelay.OneWaySeconds"/>),
        /// never collapsed to 0. Enums (<c>source</c>) are
        /// written as integer ordinals.
        /// </summary>
        private static void AppendCommsDelay(StringBuilder sb, Sitrep.Contract.CommsDelay delay)
        {
            sb.Append('{');
            AppendString(sb, "oneWaySeconds");
            sb.Append(':');
            if (delay.OneWaySeconds.HasValue)
            {
                AppendNumber(sb, delay.OneWaySeconds.Value);
            }
            else
            {
                AppendNull(sb);
            }

            sb.Append(',');
            AppendString(sb, "source");
            sb.Append(':');
            AppendInteger(sb, (long)delay.Source);

            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            sb.Append('{');
            AppendString(sb, "source");
            sb.Append(':');
            AppendString(sb, delay.Meta?.Source ?? "");
            sb.Append('}');

            sb.Append('}');
        }

        // Nullable-field writers: a value, or JSON null when absent.
        private static void AppendNullableBool(StringBuilder sb, bool? value)
        {
            if (value.HasValue)
            {
                AppendBool(sb, value.Value);
            }
            else
            {
                AppendNull(sb);
            }
        }

        private static void AppendNullableNumber(StringBuilder sb, double? value)
        {
            if (value.HasValue)
            {
                AppendNumber(sb, value.Value);
            }
            else
            {
                AppendNull(sb);
            }
        }

        private static void AppendNullableString(StringBuilder sb, string? value)
        {
            if (value == null)
            {
                AppendNull(sb);
            }
            else
            {
                AppendString(sb, value);
            }
        }

        /// <summary>
        /// Writes <c>vessel.inventory</c> as
        /// <c>{ stores: [...] }</c>.
        ///
        /// <para>An empty <c>stores</c> is written, never omitted: "this vessel
        /// carries nothing" and "nobody looked" are different answers, and a
        /// missing key would read as the second.</para>
        /// </summary>
        private static void AppendVesselInventory(
            StringBuilder sb, Sitrep.Contract.VesselInventory inv)
        {
            sb.Append('{');
            AppendString(sb, "stores");
            sb.Append(':');
            sb.Append('[');
            for (var i = 0; i < inv.Stores.Count; i++)
            {
                if (i > 0) sb.Append(',');
                AppendInventoryStore(sb, inv.Stores[i]);
            }
            sb.Append(']');
            sb.Append('}');
        }

        /// <summary>One part's cargo hold, with its slot and volume limits.</summary>
        private static void AppendInventoryStore(
            StringBuilder sb, Sitrep.Contract.InventoryStore store)
        {
            sb.Append('{');
            AppendString(sb, "partId");
            sb.Append(':');
            AppendNullableString(sb, store.PartId);
            sb.Append(',');
            AppendString(sb, "partName");
            sb.Append(':');
            AppendNullableString(sb, store.PartName);
            sb.Append(',');
            AppendString(sb, "items");
            sb.Append(':');
            sb.Append('[');
            for (var i = 0; i < store.Items.Count; i++)
            {
                if (i > 0) sb.Append(',');
                AppendInventoryItem(sb, store.Items[i]);
            }
            sb.Append(']');
            sb.Append(',');
            AppendString(sb, "slots");
            sb.Append(':');
            AppendNullableNumber(sb, store.Slots);
            sb.Append(',');
            AppendString(sb, "slotsUsed");
            sb.Append(':');
            AppendNullableNumber(sb, store.SlotsUsed);
            sb.Append(',');
            AppendString(sb, "packedVolumeLimit");
            sb.Append(':');
            AppendNullableNumber(sb, store.PackedVolumeLimit);
            sb.Append(',');
            AppendString(sb, "packedVolumeUsed");
            sb.Append(':');
            AppendNullableNumber(sb, store.PackedVolumeUsed);
            sb.Append(',');
            AppendString(sb, "massLimit");
            sb.Append(':');
            AppendNullableNumber(sb, store.MassLimit);
            sb.Append('}');
        }

        /// <summary>One kind of stored thing, and how many of it.</summary>
        private static void AppendInventoryItem(
            StringBuilder sb, Sitrep.Contract.InventoryItem item)
        {
            sb.Append('{');
            AppendString(sb, "name");
            sb.Append(':');
            AppendNullableString(sb, item.Name);
            sb.Append(',');
            AppendString(sb, "title");
            sb.Append(':');
            AppendNullableString(sb, item.Title);
            sb.Append(',');
            AppendString(sb, "quantity");
            sb.Append(':');
            AppendInteger(sb, item.Quantity);
            sb.Append(',');
            AppendString(sb, "packedVolume");
            sb.Append(':');
            AppendNullableNumber(sb, item.PackedVolume);
            sb.Append('}');
        }

        /// <summary>
        /// Appends the provider extension bag as <c>,"extensions":{ ... }</c>, or
        /// nothing at all when no provider filled one.
        ///
        /// <para>Omitted rather than written as null, unlike every other optional
        /// field in these flatteners. The bag is a mechanism, not a reading: a
        /// payload no provider extended is byte-for-byte the same as one from a
        /// payload type with no bag.</para>
        ///
        /// <para>The namespaces themselves go through <see cref="AppendValue"/>:
        /// they are the provider's own untyped value tree (a
        /// <c>Dictionary&lt;string, object?&gt;</c>), exactly the shape this writer
        /// already walks for every producer-flattened payload. Core never learns
        /// the provider's shape.</para>
        /// </summary>
        private static void AppendProviderExtensions(
            StringBuilder sb,
            IDictionary<string, object?>? extensions)
        {
            if (extensions == null || extensions.Count == 0)
            {
                return;
            }

            sb.Append(',');
            AppendString(sb, Sitrep.Contract.ProviderExtensions.WireField);
            sb.Append(':');
            AppendObject(sb, extensions);
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.IsruDrillEntry"/> to the wire
        /// object <c>{ partId, partTitle, resource, deployed, running, abundance,
        /// rate }</c>, plus <c>extensions</c> when a provider filled its namespace
        /// (omitted rather than null when empty; see
        /// <see cref="AppendProviderExtensions"/>): camelCase keys, JSON null for absent
        /// nullable fields, matching the generated SDK interface. <c>isru.drills</c>
        /// publishes a <c>List&lt;IsruDrillEntry&gt;</c> raw, whose elements route
        /// through here via <see cref="AppendValue"/>'s <c>IEnumerable</c> case.
        /// </summary>
        private static void AppendIsruDrillEntry(StringBuilder sb, Sitrep.Contract.IsruDrillEntry d)
        {
            sb.Append('{');
            AppendString(sb, "partId");
            sb.Append(':');
            AppendNullableString(sb, d.PartId);
            sb.Append(',');
            AppendString(sb, "partTitle");
            sb.Append(':');
            AppendNullableString(sb, d.PartTitle);
            sb.Append(',');
            AppendString(sb, "resource");
            sb.Append(':');
            AppendNullableString(sb, d.Resource);
            sb.Append(',');
            AppendString(sb, "deployed");
            sb.Append(':');
            AppendNullableBool(sb, d.Deployed);
            sb.Append(',');
            AppendString(sb, "running");
            sb.Append(':');
            AppendNullableBool(sb, d.Running);
            sb.Append(',');
            AppendString(sb, "abundance");
            sb.Append(':');
            AppendNullableNumber(sb, d.Abundance);
            sb.Append(',');
            AppendString(sb, "rate");
            sb.Append(':');
            AppendNullableNumber(sb, d.Rate);
            AppendProviderExtensions(sb, d.Extensions);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.IsruConverterEntry"/> to the wire
        /// object <c>{ partId, partTitle, running, inputs, outputs }</c>, plus
        /// <c>extensions</c> when a provider filled its namespace. The two recipe
        /// sides are always written as arrays, empty rather than null, because the
        /// contract declares them non-nullable lists: a converter with no recipe has
        /// no flows, which is an empty recipe rather than an unknown one.
        /// </summary>
        private static void AppendIsruConverterEntry(StringBuilder sb, Sitrep.Contract.IsruConverterEntry c)
        {
            sb.Append('{');
            AppendString(sb, "partId");
            sb.Append(':');
            AppendNullableString(sb, c.PartId);
            sb.Append(',');
            AppendString(sb, "partTitle");
            sb.Append(':');
            AppendNullableString(sb, c.PartTitle);
            sb.Append(',');
            AppendString(sb, "running");
            sb.Append(':');
            AppendNullableBool(sb, c.Running);
            sb.Append(',');
            AppendString(sb, "inputs");
            sb.Append(':');
            AppendArray(sb, c.Inputs ?? new List<Sitrep.Contract.IsruResourceFlow>());
            sb.Append(',');
            AppendString(sb, "outputs");
            sb.Append(':');
            AppendArray(sb, c.Outputs ?? new List<Sitrep.Contract.IsruResourceFlow>());
            AppendProviderExtensions(sb, c.Extensions);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.IsruResourceFlow"/> to the wire
        /// object <c>{ resource, rate }</c>. Nested inside a converter entry's two
        /// recipe sides, never published on its own.
        /// </summary>
        private static void AppendIsruResourceFlow(StringBuilder sb, Sitrep.Contract.IsruResourceFlow f)
        {
            sb.Append('{');
            AppendString(sb, "resource");
            sb.Append(':');
            AppendNullableString(sb, f.Resource);
            sb.Append(',');
            AppendString(sb, "rate");
            sb.Append(':');
            AppendNullableNumber(sb, f.Rate);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.FlightCurrent"/> to the wire
        /// object <c>{ flightId, vesselId, vesselName, phase }</c> (<c>phase</c>
        /// as its <see cref="Sitrep.Contract.Situation"/> integer ordinal, same
        /// convention as every other enum in this codec). See the <c>case</c>
        /// in <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendFlightCurrent(StringBuilder sb, Sitrep.Contract.FlightCurrent f)
        {
            sb.Append('{');
            AppendString(sb, "flightId");
            sb.Append(':');
            AppendString(sb, f.FlightId);
            sb.Append(',');
            AppendString(sb, "vesselId");
            sb.Append(':');
            AppendString(sb, f.VesselId);
            sb.Append(',');
            AppendString(sb, "vesselName");
            sb.Append(':');
            AppendString(sb, f.VesselName);
            sb.Append(',');
            AppendString(sb, "phase");
            sb.Append(':');
            AppendInteger(sb, (long)f.Phase);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.FlightStarted"/> to the wire
        /// object <c>{ flightId, vesselId, vesselName, ut }</c>. See the
        /// <c>case</c> in <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendFlightStarted(StringBuilder sb, Sitrep.Contract.FlightStarted f)
        {
            sb.Append('{');
            AppendString(sb, "flightId");
            sb.Append(':');
            AppendString(sb, f.FlightId);
            sb.Append(',');
            AppendString(sb, "vesselId");
            sb.Append(':');
            AppendString(sb, f.VesselId);
            sb.Append(',');
            AppendString(sb, "vesselName");
            sb.Append(':');
            AppendString(sb, f.VesselName);
            sb.Append(',');
            AppendString(sb, "ut");
            sb.Append(':');
            AppendNumber(sb, f.Ut);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.FlightEnded"/> to the wire
        /// object <c>{ flightId, vesselId, vesselName, reason, ut }</c>
        /// (<c>reason</c> as its <see cref="Sitrep.Contract.FlightEndReason"/>
        /// integer ordinal). See the <c>case</c> in <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendFlightEnded(StringBuilder sb, Sitrep.Contract.FlightEnded f)
        {
            sb.Append('{');
            AppendString(sb, "flightId");
            sb.Append(':');
            AppendString(sb, f.FlightId);
            sb.Append(',');
            AppendString(sb, "vesselId");
            sb.Append(':');
            AppendString(sb, f.VesselId);
            sb.Append(',');
            AppendString(sb, "vesselName");
            sb.Append(':');
            AppendString(sb, f.VesselName);
            sb.Append(',');
            AppendString(sb, "reason");
            sb.Append(':');
            AppendInteger(sb, (long)f.Reason);
            sb.Append(',');
            AppendString(sb, "ut");
            sb.Append(':');
            AppendNumber(sb, f.Ut);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.FlightVesselChanged"/> to the
        /// wire object <c>{ flightId, vesselId, vesselName, previousVesselId, ut }</c>,
        /// <c>previousVesselId</c> written as JSON <c>null</c> when absent,
        /// never a sentinel empty string. See the
        /// <c>case</c> in <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendFlightVesselChanged(StringBuilder sb, Sitrep.Contract.FlightVesselChanged f)
        {
            sb.Append('{');
            AppendString(sb, "flightId");
            sb.Append(':');
            AppendString(sb, f.FlightId);
            sb.Append(',');
            AppendString(sb, "vesselId");
            sb.Append(':');
            AppendString(sb, f.VesselId);
            sb.Append(',');
            AppendString(sb, "vesselName");
            sb.Append(':');
            AppendString(sb, f.VesselName);
            sb.Append(',');
            AppendString(sb, "previousVesselId");
            sb.Append(':');
            if (f.PreviousVesselId == null)
            {
                AppendNull(sb);
            }
            else
            {
                AppendString(sb, f.PreviousVesselId);
            }
            sb.Append(',');
            AppendString(sb, "ut");
            sb.Append(':');
            AppendNumber(sb, f.Ut);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.CommandGateReport"/> to the
        /// wire object <c>{ gates: [...], channels: [...] }</c>. See the <c>case</c> in
        /// <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendCommandGateReport(
            StringBuilder sb, Sitrep.Contract.CommandGateReport report)
        {
            sb.Append('{');
            AppendString(sb, "gates");
            sb.Append(':');
            sb.Append('[');
            for (var i = 0; i < report.Gates.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }
                AppendCommandGate(sb, report.Gates[i]);
            }
            sb.Append(']');
            sb.Append(',');
            AppendString(sb, "channels");
            sb.Append(':');
            sb.Append('[');
            var channels = report.Channels;
            for (var i = 0; channels != null && i < channels.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }
                AppendChannelGate(sb, channels[i]);
            }
            sb.Append(']');
            sb.Append('}');
        }

        /// <summary>Flattens one <see cref="Sitrep.Contract.ChannelGate"/> to <c>{ topic, verdict }</c>.</summary>
        private static void AppendChannelGate(StringBuilder sb, Sitrep.Contract.ChannelGate gate)
        {
            sb.Append('{');
            AppendString(sb, "topic");
            sb.Append(':');
            AppendString(sb, gate.Topic ?? "");
            sb.Append(',');
            AppendString(sb, "verdict");
            sb.Append(':');
            AppendGateVerdict(sb, gate.Verdict ?? Sitrep.Contract.GateVerdict.Pass());
            sb.Append('}');
        }

        /// <summary>
        /// Flattens one <see cref="Sitrep.Contract.CommandGate"/> to
        /// <c>{ command, verdict, itemArgument, items }</c>, each verdict through the same
        /// <see cref="AppendGateVerdict"/> a refused dispatch uses, so a client
        /// reads one shape whether the gate ruled in advance or at dispatch.
        /// </summary>
        private static void AppendCommandGate(StringBuilder sb, Sitrep.Contract.CommandGate gate)
        {
            sb.Append('{');
            AppendString(sb, "command");
            sb.Append(':');
            AppendString(sb, gate.Command ?? "");
            sb.Append(',');
            AppendString(sb, "verdict");
            sb.Append(':');
            AppendGateVerdict(sb, gate.Verdict ?? Sitrep.Contract.GateVerdict.Pass());
            sb.Append(',');
            AppendString(sb, "itemArgument");
            sb.Append(':');
            AppendString(sb, gate.ItemArgument ?? "");
            sb.Append(',');
            AppendString(sb, "items");
            sb.Append(':');
            sb.Append('[');
            var items = gate.Items;
            for (var i = 0; items != null && i < items.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }
                AppendCommandGateItem(sb, items[i]);
            }
            sb.Append(']');
            sb.Append('}');
        }

        /// <summary>Flattens one <see cref="Sitrep.Contract.CommandGateItem"/> to <c>{ value, verdict }</c>.</summary>
        private static void AppendCommandGateItem(StringBuilder sb, Sitrep.Contract.CommandGateItem item)
        {
            sb.Append('{');
            AppendString(sb, "value");
            sb.Append(':');
            AppendString(sb, item.Value ?? "");
            sb.Append(',');
            AppendString(sb, "verdict");
            sb.Append(':');
            AppendGateVerdict(sb, item.Verdict ?? Sitrep.Contract.GateVerdict.Pass());
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.ChannelEmissionReport"/> to the
        /// wire object <c>{ channels: [...] }</c>. See the <c>case</c> in
        /// <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendChannelEmissionReport(
            StringBuilder sb, Sitrep.Contract.ChannelEmissionReport report)
        {
            sb.Append('{');
            AppendString(sb, "channels");
            sb.Append(':');
            sb.Append('[');
            for (var i = 0; i < report.Channels.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }
                AppendChannelEmissionEntry(sb, report.Channels[i]);
            }
            sb.Append(']');
            sb.Append('}');
        }

        /// <summary>
        /// Flattens one <see cref="Sitrep.Contract.ChannelEmissionEntry"/> to
        /// <c>{ topic, considered, emitted, skipped, subscribers, available,
        /// born, tickMapped }</c>.
        ///
        /// <para>Hand-enumerated, so a field added to the POCO is invisible on
        /// the wire until it is added here too, the same trap
        /// <see cref="AppendPendingUplink"/> below records. Every field is
        /// written unconditionally, including zeros and falses: this
        /// payload's whole purpose is to let a reader tell zero apart from
        /// absent, so omitting a zero the way an optional field is omitted
        /// would defeat it.</para>
        /// </summary>
        private static void AppendChannelEmissionEntry(
            StringBuilder sb, Sitrep.Contract.ChannelEmissionEntry entry)
        {
            sb.Append('{');
            AppendString(sb, "topic");
            sb.Append(':');
            AppendString(sb, entry.Topic ?? "");

            sb.Append(',');
            AppendString(sb, "considered");
            sb.Append(':');
            AppendNumber(sb, entry.Considered);

            sb.Append(',');
            AppendString(sb, "emitted");
            sb.Append(':');
            AppendNumber(sb, entry.Emitted);

            sb.Append(',');
            AppendString(sb, "skipped");
            sb.Append(':');
            AppendNumber(sb, entry.Skipped);

            sb.Append(',');
            AppendString(sb, "subscribers");
            sb.Append(':');
            AppendNumber(sb, entry.Subscribers);

            sb.Append(',');
            AppendString(sb, "available");
            sb.Append(':');
            AppendBool(sb, entry.Available);

            sb.Append(',');
            AppendString(sb, "born");
            sb.Append(':');
            AppendBool(sb, entry.Born);

            sb.Append(',');
            AppendString(sb, "tickMapped");
            sb.Append(':');
            AppendBool(sb, entry.TickMapped);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.PendingUplinkQueue"/> to the
        /// wire object <c>{ pending: [...] }</c>. See the <c>case</c> in
        /// <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendPendingUplinkQueue(StringBuilder sb, Sitrep.Contract.PendingUplinkQueue queue)
        {
            sb.Append('{');
            AppendString(sb, "pending");
            sb.Append(':');
            sb.Append('[');
            for (var i = 0; i < queue.Pending.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }
                AppendPendingUplink(sb, queue.Pending[i]);
            }
            sb.Append(']');
            sb.Append('}');
        }

        /// <summary>
        /// Flattens one <see cref="Sitrep.Contract.PendingUplink"/> entry to
        /// the wire object <c>{ id, command, label, topic, vantage,
        /// dispatchedAt, oneWaySeconds, commandedValue? }</c>: the same fields
        /// <c>Sitrep.Host.Tests.UplinkPendingShapeTests</c> ratchets on
        /// <see cref="Sitrep.Contract.PendingUplink"/> itself (dispatch-time
        /// facts only, never an execution or result field).
        ///
        /// <para>Hand-enumerated, so a field added to the POCO is invisible on
        /// the wire until it is added here too. Codegen and the shape ratchet
        /// both pass without it; only a test that reads the delivered frame
        /// catches the gap, which is why the commanded-value cases in
        /// <c>UplinkPendingQueueTests</c> assert on the frame rather than on
        /// the POCO.</para>
        ///
        /// <para><c>commandedValue</c> is omitted when null rather than written
        /// as JSON null, matching how every other optional field crosses this
        /// wire and how <c>JSON.stringify</c> treats <c>undefined</c>. It also
        /// matters here specifically: a zero throttle and an unknown value must
        /// never arrive looking the same.</para>
        /// </summary>
        private static void AppendPendingUplink(StringBuilder sb, Sitrep.Contract.PendingUplink entry)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendString(sb, entry.Id);

            sb.Append(',');
            AppendString(sb, "clientRequestId");
            sb.Append(':');
            AppendString(sb, entry.ClientRequestId);

            sb.Append(',');
            AppendString(sb, "command");
            sb.Append(':');
            AppendString(sb, entry.Command);

            sb.Append(',');
            AppendString(sb, "label");
            sb.Append(':');
            AppendString(sb, entry.Label);

            sb.Append(',');
            AppendString(sb, "topic");
            sb.Append(':');
            AppendString(sb, entry.Topic);

            sb.Append(',');
            AppendString(sb, "vantage");
            sb.Append(':');
            AppendString(sb, entry.Vantage);

            sb.Append(',');
            AppendString(sb, "dispatchedAt");
            sb.Append(':');
            AppendNumber(sb, entry.DispatchedAt);

            sb.Append(',');
            AppendString(sb, "oneWaySeconds");
            sb.Append(':');
            AppendNumber(sb, entry.OneWaySeconds);

            if (entry.CommandedValue.HasValue)
            {
                sb.Append(',');
                AppendString(sb, "commandedValue");
                sb.Append(':');
                AppendNumber(sb, entry.CommandedValue.Value);
            }

            sb.Append('}');
        }

        // The comms.* flatteners share AppendCommsDelay's rules: camelCase keys, enum ordinals, PayloadMeta as { source }, JSON null for absent nullable fields.

        /// <summary>Writes a <see cref="Sitrep.Contract.PayloadMeta"/> as <c>{ source }</c>. Null meta collapses to the defaults, matching <see cref="AppendCommsDelay"/>.</summary>
        private static void AppendPayloadMeta(StringBuilder sb, Sitrep.Contract.PayloadMeta? meta)
        {
            sb.Append('{');
            AppendString(sb, "source");
            sb.Append(':');
            AppendString(sb, meta?.Source ?? "");
            sb.Append('}');
        }

        private static void AppendCommsLink(StringBuilder sb, Sitrep.Contract.CommsLink l)
        {
            sb.Append('{');
            AppendString(sb, "connected");
            sb.Append(':');
            AppendBool(sb, l.Connected);
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, l.Meta);
            sb.Append('}');
        }

        private static void AppendCommsCommandCentre(StringBuilder sb, Sitrep.Contract.CommsCommandCentre c)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendNullableString(sb, c.Id);
            sb.Append(',');
            AppendString(sb, "displayName");
            sb.Append(':');
            AppendNullableString(sb, c.DisplayName);
            sb.Append(',');
            AppendString(sb, "kind");
            sb.Append(':');
            AppendNullableString(sb, c.Kind);
            sb.Append(',');
            AppendString(sb, "bodyIndex");
            sb.Append(':');
            if (c.BodyIndex.HasValue)
            {
                AppendInteger(sb, c.BodyIndex.Value);
            }
            else
            {
                AppendNull(sb);
            }
            sb.Append('}');
        }

        /// <summary>
        /// The separation roster. The pair list is written even when empty: an
        /// absent <c>pairs</c> key and an empty one read differently, and the
        /// contract's sparseness rule means a reader has to be able to tell "no
        /// routed pairs" from "no roster".
        /// </summary>
        private static void AppendCommandCentreSeparation(
            StringBuilder sb, Sitrep.Contract.CommandCentreSeparation s)
        {
            sb.Append('{');
            AppendString(sb, "pairs");
            sb.Append(':');
            sb.Append('[');
            var first = true;
            if (s.Pairs != null)
            {
                foreach (var pair in s.Pairs)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    AppendCentreSeparationEntry(sb, pair);
                }
            }
            sb.Append(']');
            sb.Append('}');
        }

        private static void AppendCentreSeparationEntry(
            StringBuilder sb, Sitrep.Contract.CentreSeparationEntry e)
        {
            sb.Append('{');
            AppendString(sb, "from");
            sb.Append(':');
            AppendNullableString(sb, e.From);
            sb.Append(',');
            AppendString(sb, "to");
            sb.Append(':');
            AppendNullableString(sb, e.To);
            sb.Append(',');
            AppendString(sb, "oneWaySeconds");
            sb.Append(':');
            AppendNumber(sb, e.OneWaySeconds);
            sb.Append('}');
        }

        /// <summary>
        /// <c>commandCentre.activeVesselDelay</c> as <c>{ centres: [...] }</c>. The
        /// array is always written, empty included, so "no centre has a delay of
        /// its own" reads differently from a payload that never arrived.
        /// </summary>
        private static void AppendCommandCentreActiveVesselDelay(
            StringBuilder sb, Sitrep.Contract.CommandCentreActiveVesselDelay d)
        {
            sb.Append('{');
            AppendString(sb, "centres");
            sb.Append(':');
            sb.Append('[');
            var first = true;
            if (d.Centres != null)
            {
                foreach (var entry in d.Centres)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    AppendCentreDelayEntry(sb, entry);
                }
            }
            sb.Append(']');
            sb.Append('}');
        }

        private static void AppendCentreDelayEntry(
            StringBuilder sb, Sitrep.Contract.CentreDelayEntry e)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendNullableString(sb, e.Id);
            sb.Append(',');
            AppendString(sb, "oneWaySeconds");
            sb.Append(':');
            AppendNumber(sb, e.OneWaySeconds);
            sb.Append('}');
        }

        /// <summary>
        /// One <c>commandCentre.roster</c> entry as <c>{ id, displayName, kind,
        /// bodyIndex, latitude, longitude, active, isHome, isHomeFallback,
        /// delayQuality }</c>, camelCase keys in the contract's own declaration order.
        /// </summary>
        ///
        /// <remarks>
        /// <c>latitude</c> and <c>longitude</c> are written as JSON null when the
        /// centre is not surface-anchored, never as 0: a substituted zero is a real
        /// place off the west coast of Kerbin's continent, and a client plotting it
        /// cannot tell that reading from a measured one. Same rule for
        /// <c>bodyIndex</c>, whose 0 is the sun.
        /// </remarks>
        private static void AppendCommandCentreEntry(
            StringBuilder sb, Sitrep.Contract.CommandCentreEntry e)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendNullableString(sb, e.Id);
            sb.Append(',');
            AppendString(sb, "displayName");
            sb.Append(':');
            AppendNullableString(sb, e.DisplayName);
            sb.Append(',');
            AppendString(sb, "kind");
            sb.Append(':');
            AppendNullableString(sb, e.Kind);
            sb.Append(',');
            AppendString(sb, "bodyIndex");
            sb.Append(':');
            if (e.BodyIndex.HasValue)
            {
                AppendInteger(sb, e.BodyIndex.Value);
            }
            else
            {
                AppendNull(sb);
            }
            sb.Append(',');
            AppendString(sb, "latitude");
            sb.Append(':');
            AppendNullableNumber(sb, e.Latitude);
            sb.Append(',');
            AppendString(sb, "longitude");
            sb.Append(':');
            AppendNullableNumber(sb, e.Longitude);
            sb.Append(',');
            AppendString(sb, "active");
            sb.Append(':');
            AppendBool(sb, e.Active);
            sb.Append(',');
            AppendString(sb, "isHome");
            sb.Append(':');
            AppendBool(sb, e.IsHome);
            sb.Append(',');
            AppendString(sb, "isHomeFallback");
            sb.Append(':');
            AppendBool(sb, e.IsHomeFallback);
            sb.Append(',');
            AppendString(sb, "delayQuality");
            sb.Append(':');
            AppendNullableString(sb, e.DelayQuality);
            sb.Append('}');
        }

        private static void AppendUnreachableCentreEntry(
            StringBuilder sb, Sitrep.Contract.UnreachableCentreEntry e)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendString(sb, e.Id ?? "");
            sb.Append(',');
            AppendString(sb, "displayName");
            sb.Append(':');
            AppendString(sb, e.DisplayName ?? "");
            sb.Append(',');
            AppendString(sb, "kind");
            sb.Append(':');
            AppendString(sb, e.Kind ?? "");
            sb.Append(',');
            AppendString(sb, "lastReachableUt");
            sb.Append(':');
            AppendNumber(sb, e.LastReachableUt);
            sb.Append('}');
        }

        /// <summary>
        /// One set SCET alarm as <c>{ id, name, armedBy, vantage, subject,
        /// condition, state, firedAtUt, onFire, actsOn }</c>, the element shape of the <c>alarm.scet</c>
        /// array.
        /// </summary>
        ///
        /// <remarks>
        /// <c>state</c> goes as its ordinal, the wire form every other contract
        /// enum takes. <c>firedAtUt</c> is JSON null while the alarm is waiting to fire
        /// rather than 0, which is a real instant (the game's own epoch) and
        /// would read to a client as an alarm that fired at the dawn of the save.
        /// </remarks>
        private static void AppendScetAlarm(
            StringBuilder sb, Sitrep.Contract.ScetAlarm a)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendString(sb, a.Id ?? "");
            sb.Append(',');
            AppendString(sb, "name");
            sb.Append(':');
            AppendString(sb, a.Name ?? "");
            sb.Append(',');
            AppendString(sb, "armedBy");
            sb.Append(':');
            AppendString(sb, a.ArmedBy ?? "");
            sb.Append(',');
            AppendString(sb, "vantage");
            sb.Append(':');
            AppendString(sb, a.Vantage ?? "");
            sb.Append(',');
            AppendString(sb, "subject");
            sb.Append(':');
            AppendString(sb, a.Subject ?? "");
            sb.Append(',');
            AppendString(sb, "condition");
            sb.Append(':');
            if (a.Condition == null)
            {
                AppendNull(sb);
            }
            else
            {
                AppendScetAlarmCondition(sb, a.Condition);
            }
            sb.Append(',');
            AppendString(sb, "withheld");
            sb.Append(':');
            AppendBool(sb, a.Withheld);
            sb.Append(',');
            AppendString(sb, "state");
            sb.Append(':');
            AppendInteger(sb, (int)a.State);
            sb.Append(',');
            AppendString(sb, "firedAtUt");
            sb.Append(':');
            AppendNullableNumber(sb, a.FiredAtUt);
            sb.Append(',');
            AppendString(sb, "onFire");
            sb.Append(':');
            sb.Append('[');
            var actions = a.OnFire ?? new System.Collections.Generic.List<Sitrep.Contract.ScetAlarmAction>();
            for (var i = 0; i < actions.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }
                AppendScetAlarmAction(sb, actions[i]);
            }
            sb.Append(']');
            sb.Append(',');
            AppendString(sb, "actsOn");
            sb.Append(':');
            AppendString(sb, a.ActsOn ?? "");
            sb.Append('}');
        }

        /// <summary>
        /// A SCET alarm's condition as <c>{ kind, ut, leadSeconds, topic,
        /// fieldPath, op, threshold, sustainSeconds, contractId, parameterTitle,
        /// targetState }</c>.
        /// </summary>
        ///
        /// <remarks>
        /// Every field every time, including the half <c>kind</c> says is
        /// meaningless. The roster is a list of things the operator asked for,
        /// and a reader that has to branch on <c>kind</c> before it can tell an
        /// omitted field from an absent one is a reader that will get it wrong;
        /// the unused half carries its type's zero, which is what the contract's
        /// own defaults say it is.
        /// </remarks>
        private static void AppendScetAlarmCondition(
            StringBuilder sb, Sitrep.Contract.ScetAlarmCondition c)
        {
            sb.Append('{');
            AppendString(sb, "kind");
            sb.Append(':');
            AppendInteger(sb, (int)c.Kind);
            sb.Append(',');
            AppendString(sb, "ut");
            sb.Append(':');
            AppendNumber(sb, c.Ut);
            sb.Append(',');
            AppendString(sb, "leadSeconds");
            sb.Append(':');
            AppendNumber(sb, c.LeadSeconds);
            sb.Append(',');
            AppendString(sb, "topic");
            sb.Append(':');
            AppendString(sb, c.Topic ?? "");
            sb.Append(',');
            AppendString(sb, "fieldPath");
            sb.Append(':');
            AppendString(sb, c.FieldPath ?? "");
            sb.Append(',');
            AppendString(sb, "op");
            sb.Append(':');
            AppendInteger(sb, (int)c.Op);
            sb.Append(',');
            AppendString(sb, "threshold");
            sb.Append(':');
            AppendNumber(sb, c.Threshold);
            sb.Append(',');
            AppendString(sb, "sustainSeconds");
            sb.Append(':');
            AppendNumber(sb, c.SustainSeconds);
            sb.Append(',');
            AppendString(sb, "contractId");
            sb.Append(':');
            AppendString(sb, c.ContractId ?? "");
            sb.Append(',');
            AppendString(sb, "parameterTitle");
            sb.Append(':');
            AppendString(sb, c.ParameterTitle ?? "");
            sb.Append(',');
            AppendString(sb, "targetState");
            sb.Append(':');
            AppendInteger(sb, (int)c.TargetState);
            sb.Append('}');
        }

        /// <summary>
        /// One onboard action as <c>{ kind, group }</c>, <c>kind</c> as its
        /// ordinal. <c>group</c> goes every time, zero for a kind that is not a
        /// custom group, for the reason <see cref="AppendScetAlarmCondition"/>
        /// writes its unused half.
        /// </summary>
        private static void AppendScetAlarmAction(
            StringBuilder sb, Sitrep.Contract.ScetAlarmAction a)
        {
            sb.Append('{');
            AppendString(sb, "kind");
            sb.Append(':');
            AppendInteger(sb, (int)a.Kind);
            sb.Append(',');
            AppendString(sb, "group");
            sb.Append(':');
            AppendInteger(sb, a.Group);
            sb.Append('}');
        }

        /// <summary>One addressable SCET threshold Topic as <c>{ topic }</c>.</summary>
        private static void AppendScetAddressableTopic(
            StringBuilder sb, Sitrep.Contract.ScetAddressableTopic t)
        {
            sb.Append('{');
            AppendString(sb, "topic");
            sb.Append(':');
            AppendString(sb, t.Topic ?? "");
            sb.Append('}');
        }

        /// <summary>
        /// The fire notice as <c>{ id, firedAtUt, vantage, actionsWithheld }</c>.
        /// See <see cref="Sitrep.Contract.ScetAlarmFired"/> for why nothing about
        /// the craft may travel on this channel. The vantage is the place the
        /// operator named when they set it, and <c>actionsWithheld</c> says the
        /// craft being flown was not the one the actions were for: facts about
        /// the alarm and the game, not readings of anything aboard.
        /// </summary>
        private static void AppendScetAlarmFired(
            StringBuilder sb, Sitrep.Contract.ScetAlarmFired f)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendString(sb, f.Id ?? "");
            sb.Append(',');
            AppendString(sb, "firedAtUt");
            sb.Append(':');
            AppendNumber(sb, f.FiredAtUt);
            sb.Append(',');
            AppendString(sb, "vantage");
            sb.Append(':');
            AppendString(sb, f.Vantage ?? "");
            sb.Append(',');
            AppendString(sb, "actionsWithheld");
            sb.Append(':');
            AppendBool(sb, f.ActionsWithheld);
            sb.Append('}');
        }

        /// <summary>
        /// A transmission's <c>{ subjectId, title, startedAt, streamSeconds,
        /// dataAmount }</c>, the payload half of <c>science.experiment.transmit</c>'s reply.
        /// </summary>
        private static void AppendScienceTransmission(
            StringBuilder sb, Sitrep.Contract.ScienceTransmission t)
        {
            sb.Append('{');
            AppendString(sb, "subjectId");
            sb.Append(':');
            AppendString(sb, t.SubjectId);
            sb.Append(',');
            AppendString(sb, "title");
            sb.Append(':');
            AppendString(sb, t.Title);
            sb.Append(',');
            AppendString(sb, "startedAt");
            sb.Append(':');
            AppendNumber(sb, t.StartedAt);
            sb.Append(',');
            AppendString(sb, "streamSeconds");
            sb.Append(':');
            AppendNumber(sb, t.StreamSeconds);
            sb.Append(',');
            AppendString(sb, "dataAmount");
            sb.Append(':');
            AppendNumber(sb, t.DataAmount);
            sb.Append('}');
        }

        private static void AppendCommsConnectivity(StringBuilder sb, Sitrep.Contract.CommsConnectivity c)
        {
            sb.Append('{');
            AppendString(sb, "connected");
            sb.Append(':');
            AppendBool(sb, c.Connected);
            sb.Append(',');
            AppendString(sb, "controlSource");
            sb.Append(':');
            AppendInteger(sb, (long)c.ControlSource);
            sb.Append(',');
            AppendString(sb, "hasLocalControl");
            sb.Append(':');
            AppendBool(sb, c.HasLocalControl);
            sb.Append('}');
        }

        private static void AppendCommsSignal(StringBuilder sb, Sitrep.Contract.CommsSignal s)
        {
            sb.Append('{');
            AppendString(sb, "strength");
            sb.Append(':');
            AppendNumber(sb, s.Strength);
            sb.Append('}');
        }

        private static void AppendCommsControl(StringBuilder sb, Sitrep.Contract.CommsControl c)
        {
            sb.Append('{');
            AppendString(sb, "level");
            sb.Append(':');
            AppendInteger(sb, (long)c.Level);
            sb.Append(',');
            AppendString(sb, "reason");
            sb.Append(':');
            if (c.Reason == null)
            {
                AppendNull(sb);
            }
            else
            {
                AppendString(sb, c.Reason);
            }
            sb.Append('}');
        }

        private static void AppendCommsHop(StringBuilder sb, Sitrep.Contract.CommsHop h)
        {
            sb.Append('{');
            AppendString(sb, "from");
            sb.Append(':');
            AppendString(sb, h.From ?? "");
            sb.Append(',');
            AppendString(sb, "to");
            sb.Append(':');
            AppendString(sb, h.To ?? "");
            sb.Append(',');
            AppendString(sb, "fromIsHome");
            sb.Append(':');
            AppendBool(sb, h.FromIsHome);
            sb.Append(',');
            AppendString(sb, "toIsHome");
            sb.Append(':');
            AppendBool(sb, h.ToIsHome);
            sb.Append(',');
            AppendString(sb, "kind");
            sb.Append(':');
            AppendInteger(sb, (long)h.Kind);
            sb.Append(',');
            AppendString(sb, "distanceMeters");
            sb.Append(':');
            if (h.DistanceMeters.HasValue)
            {
                AppendNumber(sb, h.DistanceMeters.Value);
            }
            else
            {
                AppendNull(sb);
            }
            // Omitted entirely when no provider filled a bag (see AppendProviderExtensions).
            AppendProviderExtensions(sb, h.Extensions);
            sb.Append('}');
        }

        private static void AppendCommsPath(StringBuilder sb, Sitrep.Contract.CommsPath p)
        {
            sb.Append('{');
            AppendString(sb, "hops");
            sb.Append(':');
            sb.Append('[');
            if (p.Hops != null)
            {
                var first = true;
                foreach (var hop in p.Hops)
                {
                    if (!first)
                    {
                        sb.Append(',');
                    }
                    first = false;
                    AppendCommsHop(sb, hop);
                }
            }
            sb.Append(']');
            sb.Append('}');
        }

        private static void AppendCommsNetworkNode(StringBuilder sb, Sitrep.Contract.CommsNetworkNode n)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendString(sb, n.Id ?? "");
            sb.Append(',');
            AppendString(sb, "displayName");
            sb.Append(':');
            AppendString(sb, n.DisplayName ?? "");
            sb.Append(',');
            AppendString(sb, "kind");
            sb.Append(':');
            AppendInteger(sb, (long)n.Kind);
            sb.Append('}');
        }

        private static void AppendCommsNetworkEdge(StringBuilder sb, Sitrep.Contract.CommsNetworkEdge e)
        {
            sb.Append('{');
            AppendString(sb, "a");
            sb.Append(':');
            AppendString(sb, e.A ?? "");
            sb.Append(',');
            AppendString(sb, "b");
            sb.Append(':');
            AppendString(sb, e.B ?? "");
            sb.Append(',');
            AppendString(sb, "active");
            sb.Append(':');
            AppendBool(sb, e.Active);
            sb.Append('}');
        }

        private static void AppendCommsOcclusionBody(StringBuilder sb, Sitrep.Contract.CommsOcclusionBody b)
        {
            sb.Append('{');
            AppendString(sb, "index");
            sb.Append(':');
            AppendInteger(sb, b.Index);
            sb.Append(',');
            AppendString(sb, "name");
            sb.Append(':');
            AppendNullableString(sb, b.Name);
            sb.Append(',');
            AppendString(sb, "radiusMeters");
            sb.Append(':');
            AppendNumber(sb, b.RadiusMeters);
            sb.Append(',');
            AppendString(sb, "hasAtmosphere");
            sb.Append(':');
            AppendBool(sb, b.HasAtmosphere);
            sb.Append(',');
            AppendString(sb, "occludingRadiusMeters");
            sb.Append(':');
            AppendNumber(sb, b.OccludingRadiusMeters);
            sb.Append('}');
        }

        private static void AppendCommsOcclusion(StringBuilder sb, Sitrep.Contract.CommsOcclusion o)
        {
            sb.Append('{');
            AppendString(sb, "modelId");
            sb.Append(':');
            AppendString(sb, o.ModelId ?? "");
            sb.Append(',');
            AppendString(sb, "modelName");
            sb.Append(':');
            AppendString(sb, o.ModelName ?? "");
            sb.Append(',');
            AppendString(sb, "bodies");
            sb.Append(':');
            sb.Append('[');
            if (o.Bodies != null)
            {
                var first = true;
                foreach (var body in o.Bodies)
                {
                    if (!first)
                    {
                        sb.Append(',');
                    }
                    first = false;
                    AppendCommsOcclusionBody(sb, body);
                }
            }
            sb.Append(']');
            sb.Append('}');
        }

        /// <summary>
        /// The link grading. <c>level</c> is written as an explicit JSON null
        /// when nothing graded the link, never omitted and never substituted:
        /// absent and 0 are opposite instructions to a consumer choosing a
        /// quality, and a missing key reads as the second in every client that
        /// defaults a number.
        /// </summary>
        private static void AppendCommsDegrade(StringBuilder sb, Sitrep.Contract.CommsDegrade d)
        {
            sb.Append('{');
            AppendString(sb, "modelId");
            sb.Append(':');
            AppendString(sb, d.ModelId ?? "");
            sb.Append(',');
            AppendString(sb, "modelName");
            sb.Append(':');
            AppendString(sb, d.ModelName ?? "");
            sb.Append(',');
            AppendString(sb, "level");
            sb.Append(':');
            if (d.Level.HasValue)
            {
                AppendNumber(sb, d.Level.Value);
            }
            else
            {
                AppendNull(sb);
            }
            sb.Append('}');
        }

        private static void AppendCommsNetwork(StringBuilder sb, Sitrep.Contract.CommsNetwork n)
        {
            sb.Append('{');
            AppendString(sb, "nodes");
            sb.Append(':');
            sb.Append('[');
            if (n.Nodes != null)
            {
                var first = true;
                foreach (var node in n.Nodes)
                {
                    if (!first)
                    {
                        sb.Append(',');
                    }
                    first = false;
                    AppendCommsNetworkNode(sb, node);
                }
            }
            sb.Append(']');
            sb.Append(',');
            AppendString(sb, "edges");
            sb.Append(':');
            sb.Append('[');
            if (n.Edges != null)
            {
                var first = true;
                foreach (var edge in n.Edges)
                {
                    if (!first)
                    {
                        sb.Append(',');
                    }
                    first = false;
                    AppendCommsNetworkEdge(sb, edge);
                }
            }
            sb.Append(']');
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, n.Meta);
            sb.Append('}');
        }

        // RaWire, beside the Uplink that publishes comms.linkQuality / dataRate / linkMargin, mirrors AppendPayloadMeta for its nested meta object; the two must agree.

        private static void AppendObject(StringBuilder sb, IDictionary<string, object?> obj)
        {
            sb.Append('{');
            var first = true;
            foreach (var pair in obj)
            {
                if (!first)
                {
                    sb.Append(',');
                }
                first = false;
                AppendString(sb, pair.Key);
                sb.Append(':');
                AppendValue(sb, pair.Value);
            }
            sb.Append('}');
        }

        /// <summary>
        /// Writes any non-string, non-dictionary <see cref="IEnumerable"/> as
        /// a JSON array: covers both the hand-built <c>List&lt;object?&gt;</c>
        /// shape and a real typed array (<c>double[]</c>, <c>object?[]</c>,
        /// ...). Enumerating as plain (non-generic) <see cref="IEnumerable"/>
        /// yields each element already boxed as <c>object</c>, so a
        /// <c>double[]</c> element arrives as a boxed <c>double</c> and hits
        /// <see cref="AppendValue"/>'s <c>case double d</c> exactly like any
        /// other numeric value: same NaN/Infinity sentinel path either way.
        /// </summary>
        private static void AppendArray(StringBuilder sb, IEnumerable list)
        {
            sb.Append('[');
            var first = true;
            foreach (var item in list)
            {
                if (!first)
                {
                    sb.Append(',');
                }
                first = false;
                AppendValue(sb, item);
            }
            sb.Append(']');
        }

        /// <summary>
        /// Formats a finite double as the shortest round-trippable decimal
        /// string, matching <c>JSON.stringify</c> for realistic
        /// telemetry-range magnitudes: no redundant trailing zeros, negative
        /// zero collapsed to <c>"0"</c> (JS's <c>JSON.stringify(-0) === "0"</c>),
        /// and (for the rare very-large/very-small magnitude that triggers
        /// exponential notation) a lowercased, non-zero-padded exponent
        /// (<c>"1e+21"</c> / <c>"1e-7"</c>) to look like V8's own output.
        ///
        /// <para>Not byte-for-byte parity with V8's shortest-round-trip and
        /// fixed-versus-exponential switchover (ECMA-262 Number::ToString) across
        /// every possible double. Telemetry values sit within the range where
        /// .NET's shortest-round-trippable formatting agrees with JS's default
        /// conversion.</para>
        /// </summary>
        private static string FormatFiniteNumber(double value)
        {
            // IEEE-754: -0.0 == 0.0, so this also normalizes negative zero.
            if (value == 0)
            {
                return "0";
            }

            var s = value.ToString(CultureInfo.InvariantCulture);

            var eIndex = s.IndexOfAny(new[] { 'E', 'e' });
            if (eIndex < 0)
            {
                return s;
            }

            var mantissa = s.Substring(0, eIndex);
            var expPart = s.Substring(eIndex + 1);
            var negativeExp = expPart.Length > 0 && expPart[0] == '-';
            var digits = expPart.TrimStart('+', '-').TrimStart('0');
            if (digits.Length == 0)
            {
                digits = "0";
            }
            return mantissa + "e" + (negativeExp ? "-" : "+") + digits;
        }
    }
}
