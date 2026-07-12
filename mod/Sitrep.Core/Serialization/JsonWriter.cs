using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Sitrep.Core.Serialization
{
    /// <summary>
    /// Hand-written, allocation-conscious JSON writer — no Json.NET, no
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
        /// THE only place a <see cref="double"/> is ever appended — see
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

        /// <summary>Appends a JSON integer (used for <c>Meta.Seq</c> and enum ordinals) — always finite, no sentinel policy applies.</summary>
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
        /// <c>Dictionary&lt;string, object?&gt;</c>, and <c>List&lt;object?&gt;</c>
        /// — the same shape <c>CourierGoldenFixtureTests.ToClrValue</c> already
        /// uses elsewhere in this codebase. Numbers always go through
        /// <see cref="AppendNumber"/>, so the NaN/Infinity policy applies
        /// uniformly however deeply nested the value is.
        ///
        /// WIDER NUMERIC TYPES (C2-2, second fail-soft round): a channel
        /// mapper is uplink-authored and can legitimately hand back any
        /// of the numeric CLR types <c>ChannelEmitter.TryToDouble</c>
        /// already accepts for its deadband gate — <c>short</c>/<c>sbyte</c>/
        /// <c>byte</c>/<c>uint</c>/<c>ulong</c>/<c>decimal</c>, not just
        /// <c>double</c>/<c>float</c>/<c>int</c>/<c>long</c>. Before this
        /// fix, one of those types would clear the emitter's gate fine and
        /// only THEN throw <c>NotSupportedException</c> here, at delivery
        /// time — every one of those is now converted (widened to
        /// <c>double</c>, matching the emitter's own conversion) and routed
        /// through <see cref="AppendNumber"/> exactly like any other number.
        ///
        /// ARRAYS: anything else that's an <see cref="IEnumerable"/> (e.g.
        /// <c>double[]</c>, <c>object?[]</c>, <c>float[]</c> — any real
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
                    // the raw value), which JsonWriter otherwise cannot serialize
                    // — before this case it fail-softed at the wire boundary,
                    // meaning a client that subscribed comms.delay got nothing.
                    // Flattened to { oneWaySeconds, source, meta:{ source,
                    // quality } } with enum ordinals + camelCase keys, matching
                    // every other enum/field in this codec. Additive: no wire
                    // fixture serialized a CommsDelay successfully before this,
                    // so nothing existing changes shape.
                    AppendCommsDelay(sb, commsDelay);
                    break;
                case Sitrep.Contract.KosProcessorInfo processor:
                    // Same "producer owns the flatten" boundary as CommsDelay /
                    // CommandResult above: the kos.processors channel publishes a
                    // List<KosProcessorInfo> (see Gonogo.Kos.KosExtension.
                    // HandleProcessors). The list itself reaches AppendArray via
                    // the IEnumerable case below, which calls AppendValue on each
                    // element — this case flattens that element. Without it a
                    // NON-EMPTY processor list threw NotSupportedException at the
                    // wire boundary and fail-softed to nothing (an EMPTY list
                    // serialized fine as `[]`, which is why a vessel WITH kOS CPUs
                    // got zero stream-data while an empty one silently "worked").
                    AppendKosProcessorInfo(sb, processor);
                    break;
                case Sitrep.Contract.KosTerminalFrame terminalFrame:
                    // Same "producer owns the flatten" boundary as CommsDelay /
                    // KosProcessorInfo above: kos.terminal.<coreId> publishes a
                    // KosTerminalFrame POCO RAW (see KosExtension.cs's
                    // _terminalManager publish lambda — .Publish(frame, ...) with
                    // no ToWire flatten). Without this case every interactive
                    // terminal downlink frame threw NotSupportedException at the
                    // wire boundary and fail-softed to nothing — the client opened
                    // a terminal that never painted.
                    AppendKosTerminalFrame(sb, terminalFrame);
                    break;
                case Sitrep.Contract.CommsConnectivity connectivity:
                    // Same "producer owns the flatten" boundary as CommsDelay /
                    // KosProcessorInfo above: the comms.connectivity channel
                    // publishes a CommsConnectivity POCO (see
                    // Gonogo.KSP.CommsCoreUplink.HandleOnCourier). Without a case
                    // here a populated payload threw NotSupportedException at the
                    // wire boundary and fail-softed to nothing — the client
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
                case Sitrep.Contract.CommsLinkQuality linkQuality:
                    AppendCommsLinkQuality(sb, linkQuality);
                    break;
                case Sitrep.Contract.CommsDataRate dataRate:
                    AppendCommsDataRate(sb, dataRate);
                    break;
                case Sitrep.Contract.CommsLinkMargin linkMargin:
                    AppendCommsLinkMargin(sb, linkMargin);
                    break;
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
        /// <c>{ success, errorCode, [payload] }</c>. <c>errorCode</c> is the
        /// enum's integer ordinal (same convention as every other enum in
        /// this codec). The <c>payload</c> key is emitted ONLY for the
        /// generic subtype — read reflectively because <c>T</c> is open here —
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
        /// Enum values (<c>source</c>, <c>meta.quality</c>) are emitted as their
        /// integer ordinal, the same convention as <c>Meta.quality</c>/
        /// <c>Meta.staleness</c> and <see cref="AppendCommandResult"/>'s
        /// <c>errorCode</c>. See the <c>case</c> in <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendCommsDelay(StringBuilder sb, Sitrep.Contract.CommsDelay delay)
        {
            sb.Append('{');
            AppendString(sb, "oneWaySeconds");
            sb.Append(':');
            AppendNumber(sb, delay.OneWaySeconds);

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

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.KosTerminalFrame"/> to the wire
        /// object <c>{ coreId, chunk, fullRepaint }</c> (camelCase keys, matching
        /// the generated SDK shape). See the <c>case</c> in
        /// <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendKosTerminalFrame(StringBuilder sb, Sitrep.Contract.KosTerminalFrame frame)
        {
            sb.Append('{');
            AppendString(sb, "coreId");
            sb.Append(':');
            AppendInteger(sb, frame.CoreId);
            sb.Append(',');
            AppendString(sb, "chunk");
            sb.Append(':');
            AppendString(sb, frame.Chunk ?? "");
            sb.Append(',');
            AppendString(sb, "fullRepaint");
            sb.Append(':');
            AppendBool(sb, frame.FullRepaint);
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
        /// wire object <c>{ flightId, vesselId, vesselName, previousVesselId, ut }</c>
        /// — <c>previousVesselId</c> written as JSON <c>null</c> when absent
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
        /// Flattens a <see cref="Sitrep.Contract.KosProcessorInfo"/> to the wire
        /// object <c>{ coreId, tag, hasBooted, bootFilePath, processorMode }</c>
        /// (camelCase keys, matching the generated TS contract the KosProcessors
        /// widget consumes). Nullable <c>tag</c>/<c>bootFilePath</c> are written
        /// as JSON <c>null</c> when absent (R7 typed-absence), never a sentinel
        /// empty string. See the <c>case</c> in <see cref="AppendValue"/>.
        /// </summary>
        private static void AppendKosProcessorInfo(StringBuilder sb, Sitrep.Contract.KosProcessorInfo p)
        {
            sb.Append('{');
            AppendString(sb, "coreId");
            sb.Append(':');
            AppendInteger(sb, p.CoreId);

            sb.Append(',');
            AppendString(sb, "tag");
            sb.Append(':');
            if (p.Tag == null)
            {
                AppendNull(sb);
            }
            else
            {
                AppendString(sb, p.Tag);
            }

            sb.Append(',');
            AppendString(sb, "hasBooted");
            sb.Append(':');
            AppendBool(sb, p.HasBooted);

            sb.Append(',');
            AppendString(sb, "bootFilePath");
            sb.Append(':');
            if (p.BootFilePath == null)
            {
                AppendNull(sb);
            }
            else
            {
                AppendString(sb, p.BootFilePath);
            }

            sb.Append(',');
            AppendString(sb, "processorMode");
            sb.Append(':');
            AppendString(sb, p.ProcessorMode ?? "");

            sb.Append('}');
        }

        // ================================================================
        // comms.* payload flatteners (U2 wire-boundary fix). Each mirrors
        // AppendCommsDelay / AppendKosProcessorInfo: camelCase keys, enum
        // ordinals as integers, PayloadMeta as { source, quality }, and
        // nullable fields written as JSON null (R7 typed-absence) rather than
        // a sentinel. Without these, a POPULATED comms.* payload threw
        // NotSupportedException in AppendValue at the wire boundary and the
        // frame was dropped — a subscribed client received only "subscribed"
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

        private static void AppendCommsLinkQuality(StringBuilder sb, Sitrep.Contract.CommsLinkQuality q)
        {
            sb.Append('{');
            AppendString(sb, "value");
            sb.Append(':');
            AppendNumber(sb, q.Value);
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, q.Meta);
            sb.Append('}');
        }

        private static void AppendCommsDataRate(StringBuilder sb, Sitrep.Contract.CommsDataRate r)
        {
            sb.Append('{');
            AppendString(sb, "upBitsPerSec");
            sb.Append(':');
            AppendNumber(sb, r.UpBitsPerSec);
            sb.Append(',');
            AppendString(sb, "downBitsPerSec");
            sb.Append(':');
            AppendNumber(sb, r.DownBitsPerSec);
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, r.Meta);
            sb.Append('}');
        }

        private static void AppendCommsLinkMargin(StringBuilder sb, Sitrep.Contract.CommsLinkMargin m)
        {
            sb.Append('{');
            AppendString(sb, "decibelMargin");
            sb.Append(':');
            AppendNumber(sb, m.DecibelMargin);
            sb.Append(',');
            AppendString(sb, "closesLink");
            sb.Append(':');
            AppendBool(sb, m.ClosesLink);
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, m.Meta);
            sb.Append('}');
        }

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
        /// a JSON array — covers both the hand-built <c>List&lt;object?&gt;</c>
        /// shape and a real typed array (<c>double[]</c>, <c>object?[]</c>,
        /// ...). Enumerating as plain (non-generic) <see cref="IEnumerable"/>
        /// yields each element already boxed as <c>object</c>, so a
        /// <c>double[]</c> element arrives as a boxed <c>double</c> and hits
        /// <see cref="AppendValue"/>'s <c>case double d</c> exactly like any
        /// other numeric value — same NaN/Infinity sentinel path either way.
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
        /// (ECMA-262 Number::ToString) across EVERY possible double — that's
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
