using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Sitrep.Core.Serialization
{
    /// <summary>
    /// Hand-written, allocation-conscious JSON writer: no Json.NET, no
    /// System.Text.Json (the latter is a separate NuGet package on
    /// <c>netstandard2.0</c> and would break <c>Sitrep.Core</c>'s
    /// zero-PackageReference invariant; see <c>Sitrep.Core.csproj</c>).
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
        /// THE only place a <see cref="double"/> is ever appended; see
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

        public static void AppendBool(StringBuilder sb, bool value)
        {
            sb.Append(value ? "true" : "false");
        }

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
        /// the same shape <c>CourierGoldenFixtureTests.ToClrValue</c> already
        /// uses elsewhere in this codebase. Numbers always go through
        /// <see cref="AppendNumber"/>, so the NaN/Infinity policy applies
        /// uniformly however deeply nested the value is.
        ///
        /// WIDER NUMERIC TYPES (C2-2, second fail-soft round): a channel
        /// mapper is uplink-authored and can legitimately hand back any
        /// of the numeric CLR types <c>ChannelEmitter.TryToDouble</c>
        /// already accepts for its deadband gate: <c>short</c>/<c>sbyte</c>/
        /// <c>byte</c>/<c>uint</c>/<c>ulong</c>/<c>decimal</c>, not just
        /// <c>double</c>/<c>float</c>/<c>int</c>/<c>long</c>. Before this
        /// fix, one of those types would clear the emitter's gate fine and
        /// only THEN throw <c>NotSupportedException</c> here, at delivery
        /// time: every one of those is now converted (widened to
        /// <c>double</c>, matching the emitter's own conversion) and routed
        /// through <see cref="AppendNumber"/> exactly like any other number.
        ///
        /// ARRAYS: anything else that's an <see cref="IEnumerable"/> (e.g.
        /// <c>double[]</c>, <c>object?[]</c>, <c>float[]</c>: any real
        /// capture code writes a typed array, not a hand-built
        /// <c>List&lt;object?&gt;</c>) is written as a JSON array too, one
        /// element at a time back through THIS method, so a numeric element
        /// still gets the NaN/Infinity sentinel policy and a nested
        /// array/dict still recurses correctly. This case is deliberately
        /// last among the collection cases: <c>string</c> is itself
        /// <c>IEnumerable&lt;char&gt;</c> and <c>Dictionary&lt;,&gt;</c>/
        /// <c>IDictionary&lt;,&gt;</c> are themselves <c>IEnumerable</c>, so
        /// both must (and do, per C#'s in-order switch matching) get matched
        /// by their own case above before this catch-all runs.
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
                case string s:
                    AppendString(sb, s);
                    break;
                case Sitrep.Contract.CommandResult commandResult:
                    // F2 Part 3 (R7 wire-flatten): a CommandResult /
                    // CommandResult<T> POCO is what every command handler
                    // returns and travels back as CommandResponse.Result.
                    // JsonWriter otherwise has no idea how to serialize an
                    // arbitrary POCO, so before this case existed EVERY
                    // command response (success OR failure) fail-softed at the
                    // wire boundary (see EnvelopeCodec.WriteCommandResponse ->
                    // this method). Flattened here, in the SAME "producer owns
                    // the flatten" spirit as VesselViewProvider.ToWire, rather
                    // than adding a wire-shape method to the BCL-only contract
                    // type. Enum error code is emitted as its integer ordinal,
                    // matching how every other enum in this codec serializes
                    // (Meta.quality / Meta.staleness).
                    AppendCommandResult(sb, commandResult);
                    break;
                case Sitrep.Contract.CommsDelay commsDelay:
                    // Same "producer owns the flatten" boundary as CommandResult
                    // above: comms.delay's payload is a CommsDelay POCO (see
                    // Gonogo.KSP.CommsCoreUplink.HandleOnCourier, which publishes
                    // the raw value), which JsonWriter otherwise cannot serialize,
                    // before this case it fail-softed at the wire boundary,
                    // meaning a client that subscribed comms.delay got nothing.
                    // Flattened to { oneWaySeconds, source, meta:{ source,
                    // quality } } with enum ordinals + camelCase keys, matching
                    // every other enum/field in this codec. Additive: no wire
                    // fixture serialized a CommsDelay successfully before this,
                    // so nothing existing changes shape.
                    AppendCommsDelay(sb, commsDelay);
                    break;
                // KosProcessorInfo / KosTerminalFrame / KosRunResult: kOS's
                // three raw-POCO wire types (kos.processors / kos.terminal.
                // <coreId> / kos.run.<coreId>), used to have their own cases
                // here, same "producer owns the flatten" shape as CommsDelay
                // above. As of the kos migration (2026-07-18) all three
                // self-flatten producer-side via Gonogo.KosUplink.
                // Kos*Builder.Build(), so JsonWriter never sees the raw POCO
                // any more: see WirePayloadCoverageTests.FlattenedByProducer.
                case Sitrep.Contract.GateVerdict verdict:
                    // A declared command gate's answer: the refusal payload, and
                    // the per-command entry of the addressability set. Flattened
                    // here rather than by a producer because BOTH consumers hand
                    // the POCO straight over: there is no view provider in
                    // between to own the flatten.
                    AppendGateVerdict(sb, verdict);
                    break;
                case Sitrep.Contract.LimitBreach breachValue:
                    // Reachable on its own, not only nested in a verdict: a
                    // readout that wants the comparison without the outcome.
                    AppendLimitBreach(sb, breachValue);
                    break;
                case Sitrep.Contract.CommsLink link:
                    // Same "producer owns the flatten" boundary as CommsDelay /
                    // CommsConnectivity below: the comms.link connectivity
                    // MetaTopic publishes a CommsLink POCO (see
                    // Gonogo.KSP.CommsCoreUplink's link publisher). Without this
                    // case a populated payload would throw NotSupportedException
                    // at the wire boundary and the client's "NO SIGNAL" edge
                    // would never arrive. Flattened to { connected, meta } with
                    // camelCase keys, matching every sibling below.
                    AppendCommsLink(sb, link);
                    break;
                case Sitrep.Contract.CommsConnectivity connectivity:
                    // Same "producer owns the flatten" boundary as CommsDelay
                    // above: the comms.connectivity channel
                    // publishes a CommsConnectivity POCO (see
                    // Gonogo.KSP.CommsCoreUplink.HandleOnCourier). Without a case
                    // here a populated payload threw NotSupportedException at the
                    // wire boundary and fail-softed to nothing, the client
                    // subscribed but got zero stream-data.
                    AppendCommsConnectivity(sb, connectivity);
                    break;
                case Sitrep.Contract.CommsSignalStrength signalStrength:
                    AppendCommsSignalStrength(sb, signalStrength);
                    break;
                case Sitrep.Contract.CommsControlState controlState:
                    AppendCommsControlState(sb, controlState);
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
                case Sitrep.Contract.CommsOcclusionBody occlusionBody:
                    // Reached element-by-element from AppendCommsOcclusion's own
                    // loop, and handled here too so a bare entry routed through
                    // AppendValue flattens rather than throwing, same as CommsHop.
                    AppendCommsOcclusionBody(sb, occlusionBody);
                    break;
                // The three provider-private comms payloads (comms.linkQuality /
                // comms.dataRate / comms.linkMargin) had a case each right here.
                // Their types left this assembly's reach for
                // GonogoRealAntennasUplink.Contract, and a core serializer may not
                // reference an Uplink's assembly, so their producer now flattens
                // them to a Dictionary<string, object?> before Publish (RaWire)
                // and they arrive through the IDictionary case below. That is the
                // same self-flattening producer boundary every other relocated
                // Uplink already used; this one was the last publisher in the mod
                // still handing a raw POCO to a hand-written case.
                case Sitrep.Contract.FlightCurrent flightCurrent:
                    // Same "producer owns the flatten" boundary as CommsDelay
                    // above: flight.current publishes a FlightCurrent POCO
                    // directly (see Sitrep.Host.Flight.FlightLifecycleSampler),
                    // unlike crash/recovery which hand-flatten to a Dictionary.
                    // Without this case a populated payload threw
                    // NotSupportedException at the wire boundary.
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
                    // Same "producer owns the flatten" boundary as CommsDelay
                    // above: system.uplink.pending's channel
                    // source (ChannelEngine's UplinkPendingTopic mapper)
                    // returns a PendingUplinkQueue POCO directly. Without this
                    // case a populated (or even empty) queue threw
                    // NotSupportedException at the wire boundary and every
                    // subscriber got zero stream-data for this topic.
                    AppendPendingUplinkQueue(sb, pendingUplinkQueue);
                    break;
                case Sitrep.Contract.ReliabilitySummary reliabilitySummary:
                    // Same "producer owns the flatten" boundary as CommsDelay
                    // above: reliability.summary's producer
                    // (Gonogo.KSP.ReliabilityCoreUplink.HandleOnCourier) publishes
                    // the ReliabilitySummary POCO RAW (capture.Summary), and
                    // reliability.parts publishes a List<ReliabilityPartEntry>
                    // whose elements route through here one by one. Without these
                    // cases a populated payload threw NotSupportedException at the
                    // wire boundary and every subscriber got zero stream-data.
                    AppendReliabilitySummary(sb, reliabilitySummary);
                    break;
                case Sitrep.Contract.ReliabilityPartEntry reliabilityPartEntry:
                    AppendReliabilityPartEntry(sb, reliabilityPartEntry);
                    break;
                case Sitrep.Contract.IsruDrillEntry isruDrillEntry:
                    // Same boundary again: isru.drills/isru.converters publish
                    // List<IsruDrillEntry>/List<IsruConverterEntry> raw, whose
                    // elements route through here one by one, and a converter's
                    // recipe flows nest one level deeper still.
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
        /// <c>{ success, errorCode, [breach], [payload] }</c>. <c>breach</c> is
        /// present only on a refusal that carries a comparison (see
        /// <see cref="Sitrep.Contract.CommandResult.Breach"/>). <c>errorCode</c> is the
        /// enum's integer ordinal (same convention as every other enum in
        /// this codec). The <c>payload</c> key is emitted ONLY for the
        /// generic subtype (read reflectively because <c>T</c> is open here)
        /// so a plain <see cref="Sitrep.Contract.CommandResult"/> (the "no
        /// payload" actuation ack) serializes without a payload key at all.
        /// A null payload on a <c>CommandResult&lt;T&gt;</c> (the failure
        /// case) is still a real value and IS written as JSON <c>null</c>,
        /// via <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendCommandResult(StringBuilder sb, Sitrep.Contract.CommandResult result)
        {
            sb.Append('{');
            AppendString(sb, "success");
            sb.Append(':');
            AppendBool(sb, result.Success);

            sb.Append(',');
            AppendString(sb, "errorCode");
            sb.Append(':');
            AppendInteger(sb, (long)result.ErrorCode);

            // Only on a refusal that HAS numbers. A success carrying a null
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
        /// Flattens a <see cref="Sitrep.Contract.CommsDelay"/> to the wire
        /// object <c>{ oneWaySeconds, source, meta:{ source, quality } }</c>.
        /// <c>oneWaySeconds</c> is nullable (R7 typed absence; see
        /// <see cref="Sitrep.Contract.CommsDelay.OneWaySeconds"/>'s own doc
        /// comment): written as JSON <c>null</c> when there is no measurable
        /// path, the same nullable-double wire path as
        /// <see cref="AppendCommsHop"/>'s <c>distanceMeters</c>/
        /// <c>bandRateBitsPerSec</c>, never collapsed to a 0 sentinel. Enum
        /// values (<c>source</c>, <c>meta.quality</c>) are emitted as their
        /// integer ordinal, the same convention as <c>Meta.quality</c>/
        /// <c>Meta.staleness</c> and <see cref="AppendCommandResult"/>'s
        /// <c>errorCode</c>. See the <c>case</c> in <see cref="AppendValue"/>.
        /// </summary>
        /// <summary>
        /// A gate verdict as <c>{ outcome, breach, detail }</c>, the enum as an
        /// integer ordinal like every sibling here.
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
            sb.Append(',');
            AppendString(sb, "quality");
            sb.Append(':');
            AppendInteger(sb, (long)(delay.Meta?.Quality ?? Sitrep.Contract.Quality.OnRails));
            sb.Append('}');

            sb.Append('}');
        }

        // Nullable-field writers for the reliability.* POCOs (nearly every field
        // is optional). Each is exactly the inline "HasValue / non-null ? value :
        // JSON null" idiom the sibling helpers already use (AppendCommsDelay's
        // oneWaySeconds, AppendCommsControlState's reason): named so the two
        // reliability writers below stay one line per field.
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
        /// Flattens a <see cref="Sitrep.Contract.ReliabilitySummary"/> to the wire
        /// object <c>{ unmodeled, malfunction, critical, source,
        /// worstReliabilityFraction }</c>, plus <c>extensions</c> when a provider
        /// filled its namespace (see <see cref="AppendProviderExtensions"/>, and note
        /// that key is OMITTED rather than null when empty): camelCase keys, JSON
        /// null for absent nullable fields, matching the generated SDK interface. reliability.summary
        /// (<c>Gonogo.KSP.ReliabilityCoreUplink.HandleOnCourier</c>) publishes this
        /// POCO raw, so before this existed a populated payload threw
        /// <c>NotSupportedException</c> at the wire boundary. See the <c>case</c> in
        /// <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendReliabilitySummary(StringBuilder sb, Sitrep.Contract.ReliabilitySummary r)
        {
            sb.Append('{');
            AppendString(sb, "unmodeled");
            sb.Append(':');
            AppendNullableBool(sb, r.Unmodeled);
            sb.Append(',');
            AppendString(sb, "malfunction");
            sb.Append(':');
            AppendNullableBool(sb, r.Malfunction);
            sb.Append(',');
            AppendString(sb, "critical");
            sb.Append(':');
            AppendNullableBool(sb, r.Critical);
            sb.Append(',');
            AppendString(sb, "source");
            sb.Append(':');
            AppendNullableString(sb, r.Source);
            sb.Append(',');
            AppendString(sb, "worstReliabilityFraction");
            sb.Append(':');
            AppendNullableNumber(sb, r.WorstReliabilityFraction);
            AppendProviderExtensions(sb, r.Extensions);
            sb.Append('}');
        }

        /// <summary>
        /// Appends the provider extension bag as <c>,"extensions":{ ... }</c>, or
        /// nothing at all when no provider filled one.
        ///
        /// <para><b>Omitted rather than written as null</b>, unlike every other
        /// optional field in these flatteners. The bag is a mechanism, not a
        /// reading: a payload no provider extended has to be byte-for-byte what it
        /// was before the mechanism existed, so nothing downstream can tell the
        /// difference. That is the whole additive claim, and
        /// <c>ReliabilityExtensionWireTests</c> pins it.</para>
        ///
        /// <para>The namespaces themselves go through <see cref="AppendValue"/>:
        /// they are the provider's own untyped value tree (a
        /// <c>Dictionary&lt;string, object?&gt;</c>), exactly the shape this writer
        /// already walks for every producer-flattened payload. Core never learns
        /// the provider's shape, which is the point.</para>
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
        /// Flattens a <see cref="Sitrep.Contract.ReliabilityPartEntry"/> to the wire
        /// object <c>{ partId, title, group, broken, critical, mtbfHours,
        /// reliabilityFraction, remainingRatedBurn, ignitionsConsumed,
        /// durationConsumed, needsRepair }</c>, plus <c>extensions</c> when a
        /// provider filled its namespace (see
        /// <see cref="AppendProviderExtensions"/>): camelCase keys, JSON null for absent
        /// nullable fields, matching the generated SDK interface. reliability.parts
        /// publishes a <c>List&lt;ReliabilityPartEntry&gt;</c> raw, whose elements
        /// route through here via <see cref="AppendValue"/>'s <c>IEnumerable</c> case.
        /// See the <c>case</c> in <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendReliabilityPartEntry(StringBuilder sb, Sitrep.Contract.ReliabilityPartEntry p)
        {
            sb.Append('{');
            AppendString(sb, "partId");
            sb.Append(':');
            AppendNullableString(sb, p.PartId);
            sb.Append(',');
            AppendString(sb, "title");
            sb.Append(':');
            AppendNullableString(sb, p.Title);
            sb.Append(',');
            AppendString(sb, "group");
            sb.Append(':');
            AppendNullableString(sb, p.Group);
            sb.Append(',');
            AppendString(sb, "broken");
            sb.Append(':');
            AppendNullableBool(sb, p.Broken);
            sb.Append(',');
            AppendString(sb, "critical");
            sb.Append(':');
            AppendNullableBool(sb, p.Critical);
            sb.Append(',');
            AppendString(sb, "mtbfHours");
            sb.Append(':');
            AppendNullableNumber(sb, p.MtbfHours);
            sb.Append(',');
            AppendString(sb, "reliabilityFraction");
            sb.Append(':');
            AppendNullableNumber(sb, p.ReliabilityFraction);
            sb.Append(',');
            AppendString(sb, "remainingRatedBurn");
            sb.Append(':');
            AppendNullableNumber(sb, p.RemainingRatedBurn);
            sb.Append(',');
            AppendString(sb, "ignitionsConsumed");
            sb.Append(':');
            AppendNullableNumber(sb, p.IgnitionsConsumed);
            sb.Append(',');
            AppendString(sb, "durationConsumed");
            sb.Append(':');
            AppendNullableNumber(sb, p.DurationConsumed);
            sb.Append(',');
            AppendString(sb, "needsRepair");
            sb.Append(':');
            AppendNullableBool(sb, p.NeedsRepair);
            AppendProviderExtensions(sb, p.Extensions);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.IsruDrillEntry"/> to the wire
        /// object <c>{ partId, partTitle, resource, deployed, running, abundance,
        /// rate }</c>, plus <c>extensions</c> when a provider filled its namespace
        /// (see <see cref="AppendProviderExtensions"/>, and note that key is OMITTED
        /// rather than null when empty): camelCase keys, JSON null for absent
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
        /// sides are ALWAYS written as arrays, empty rather than null, because the
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
        /// <c>previousVesselId</c> written as JSON <c>null</c> when absent
        /// (R7 typed-absence), never a sentinel empty string. See the
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
        /// dispatchedAt, oneWaySeconds, commandedValue? }</c>: the SAME fields
        /// <c>Sitrep.Host.Tests.UplinkPendingShapeTests</c> ratchets on
        /// <see cref="Sitrep.Contract.PendingUplink"/> itself (prediction-only:
        /// dispatch-time facts only, never an execution/result field).
        ///
        /// <para>Hand-enumerated, so a field added to the POCO is invisible on
        /// the wire until it is added HERE too. That is how
        /// <c>commandedValue</c> first went missing: the contract carried it,
        /// codegen emitted it, the shape ratchet passed, and the wire simply did
        /// not have it. An integration test that reads the delivered frame is
        /// the only thing that catches that, which is why the commanded-value
        /// cases in <c>UplinkPendingQueueTests</c> assert on the frame rather
        /// than on the POCO.</para>
        ///
        /// <para><c>commandedValue</c> is OMITTED when null rather than written
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

        // ================================================================
        // comms.* payload flatteners (U2 wire-boundary fix). Each mirrors
        // AppendCommsDelay: camelCase keys, enum ordinals as integers,
        // PayloadMeta as { source, quality }, and
        // nullable fields written as JSON null (R7 typed-absence) rather than
        // a sentinel. Without these, a POPULATED comms.* payload threw
        // NotSupportedException in AppendValue at the wire boundary and the
        // frame was dropped, a subscribed client received only "subscribed"
        // and zero stream-data, exactly the kos.processors / comms.delay bug.
        // ================================================================

        /// <summary>Writes a <see cref="Sitrep.Contract.PayloadMeta"/> as <c>{ source, quality }</c> (quality as its integer ordinal). Null meta collapses to the defaults, matching <see cref="AppendCommsDelay"/>.</summary>
        private static void AppendPayloadMeta(StringBuilder sb, Sitrep.Contract.PayloadMeta? meta)
        {
            sb.Append('{');
            AppendString(sb, "source");
            sb.Append(':');
            AppendString(sb, meta?.Source ?? "");
            sb.Append(',');
            AppendString(sb, "quality");
            sb.Append(':');
            AppendInteger(sb, (long)(meta?.Quality ?? Sitrep.Contract.Quality.OnRails));
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
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, c.Meta);
            sb.Append('}');
        }

        private static void AppendCommsSignalStrength(StringBuilder sb, Sitrep.Contract.CommsSignalStrength s)
        {
            sb.Append('{');
            AppendString(sb, "value");
            sb.Append(':');
            AppendNumber(sb, s.Value);
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, s.Meta);
            sb.Append('}');
        }

        private static void AppendCommsControlState(StringBuilder sb, Sitrep.Contract.CommsControlState c)
        {
            sb.Append('{');
            AppendString(sb, "state");
            sb.Append(':');
            AppendInteger(sb, (long)c.State);
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
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, c.Meta);
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
            sb.Append(',');
            AppendString(sb, "bandRateBitsPerSec");
            sb.Append(':');
            if (h.BandRateBitsPerSec.HasValue)
            {
                AppendNumber(sb, h.BandRateBitsPerSec.Value);
            }
            else
            {
                AppendNull(sb);
            }
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
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, p.Meta);
            sb.Append('}');
        }

        private static void AppendCommsNetworkNode(StringBuilder sb, Sitrep.Contract.CommsNetworkNode n)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendString(sb, n.Id ?? "");
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
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, o.Meta);
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

        // AppendCommsLinkQuality / AppendCommsDataRate / AppendCommsLinkMargin
        // stood here. They wrote { value, meta }, { upBitsPerSec, downBitsPerSec,
        // meta } and { decibelMargin, closesLink, meta } respectively, and their
        // types have since moved out of core into
        // GonogoRealAntennasUplink.Contract. Their producer builds those exact
        // objects itself now (RaWire, beside the Uplink that publishes them), so
        // the bytes are unchanged and this file no longer needs to name a type it
        // cannot reference. AppendPayloadMeta above is what RaWire mirrors for the
        // nested meta object, quality as its integer ordinal included.

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
        /// NOT a claim of byte-for-byte parity with V8's exact
        /// shortest-round-trip / fixed-vs-exponential switchover algorithm
        /// (ECMA-262 Number::ToString) across EVERY possible double: that's
        /// out of scope for M5a. Telemetry values are realistically within
        /// the range where .NET's own shortest-round-trippable formatting
        /// already agrees with JS's default number-to-string conversion.
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
