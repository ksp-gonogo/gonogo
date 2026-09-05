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
        /// ENUMS: a boxed enum is written as its integer ordinal, matching
        /// how every DECLARED enum in this codec already serializes. It needs
        /// its own case because a boxed enum's runtime type is the enum type,
        /// so it matches neither <c>case int</c> nor any other numeric case
        /// and used to reach the <c>default</c> throw.
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
                case System.Enum e:
                    // An enum is written as its integer ordinal, the same
                    // convention every DECLARED enum in this codec already
                    // follows (Meta.quality, Meta.staleness,
                    // CommandResult.errorCode, and every enum a hand-written
                    // Append<Type> flattener writes). Without this case a
                    // boxed enum matched no case at all -- `case int i` does
                    // not match a boxed enum, whose runtime type is the enum
                    // type, not Int32 -- and reached the default branch, so
                    // an uplink publishing one of its own enums got the
                    // unsupported-type throw and its frame never left the
                    // host, despite the codec being perfectly willing to
                    // write the identical value under a contract type.
                    // Convert.ToInt64 covers every underlying integral type
                    // an enum may declare, including a ulong-backed one whose
                    // ordinal is read back through the unchecked cast below.
                    AppendInteger(sb, e.GetTypeCode() == System.TypeCode.UInt64
                        ? unchecked((long)System.Convert.ToUInt64(e, CultureInfo.InvariantCulture))
                        : System.Convert.ToInt64(e, CultureInfo.InvariantCulture));
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
                    // the raw value), which JsonWriter otherwise cannot
                    // serialize: WITHOUT this case it fail-softs at the wire
                    // boundary and a client that subscribed comms.delay gets
                    // nothing at all. Flattened to { oneWaySeconds, source,
                    // meta:{ source, quality } } with enum ordinals +
                    // camelCase keys, matching every other enum/field in this
                    // codec.
                    AppendCommsDelay(sb, commsDelay);
                    break;
                case Sitrep.Contract.VesselInventory vesselInventory:
                    // Stock cargo carried by the vessel's PARTS. Written here
                    // rather than flattened by a producer for the same reason
                    // comms.delay is: the channel source hands the POCO
                    // straight over, so without a case it fail-softs at the
                    // wire boundary and a client that subscribed gets nothing.
                    AppendVesselInventory(sb, vesselInventory);
                    break;
                case Sitrep.Contract.InventoryStore inventoryStore:
                    AppendInventoryStore(sb, inventoryStore);
                    break;
                case Sitrep.Contract.InventoryItem inventoryItem:
                    AppendInventoryItem(sb, inventoryItem);
                    break;
                case Sitrep.Contract.FlightSimulation flightSimulation:
                    // Whether the flight on screen is a rehearsal, and whether
                    // signal delay is being applied to it. Flattened here rather
                    // than by a producer because the channel source hands the
                    // POCO straight over (FlightUplink's SimulationTopic maps
                    // FlightSimulationProvider.Build directly).
                    AppendFlightSimulation(sb, flightSimulation);
                    break;
                // There is deliberately no case for the scripting Uplink's three
                // raw-POCO wire types (its processor listing, its terminal
                // channel and its per-core run result). All three self-flatten
                // producer-side in that Uplink's own builders, so JsonWriter
                // never sees the raw POCO: see
                // WirePayloadCoverageTests.FlattenedByProducer.
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
                case Sitrep.Contract.CommsCommandCentre commandCentre:
                    // Same "producer owns the flatten" boundary as CommsLink
                    // above: comms.commandCentre publishes a CommsCommandCentre
                    // POCO directly (see Gonogo.KSP.CommsCoreUplink's
                    // command-centre publisher). Without this case a populated
                    // payload would throw NotSupportedException at the wire
                    // boundary. Flattened to { id, displayName, kind, bodyIndex,
                    // meta } with camelCase keys, matching every sibling here.
                    AppendCommsCommandCentre(sb, commandCentre);
                    break;
                case Sitrep.Contract.CommandCentreSeparation separation:
                    // Same "producer owns the flatten" boundary as
                    // CommsCommandCentre above: CommandCentreDelayUplink
                    // publishes the POCO straight over. Without this case every
                    // commandCentre.separation frame threw NotSupportedException
                    // at the wire boundary and was silently dropped, so a client
                    // that subscribed sat on "subscribed" forever.
                    AppendCommandCentreSeparation(sb, separation);
                    break;
                case Sitrep.Contract.CentreSeparationEntry separationEntry:
                    AppendCentreSeparationEntry(sb, separationEntry);
                    break;
                case Sitrep.Contract.CommandCentreEntry centreEntry:
                    // Same "producer owns the flatten" boundary as
                    // CommandCentreSeparation above, and the fourth time this
                    // codec has met the same defect. commandCentre.roster is a
                    // BARE ARRAY of these entries and its producer
                    // (CommandCentreDelayUplink.ToRosterEntry) publishes the
                    // List<CommandCentreEntry> raw, so every element arrives here
                    // through the IEnumerable case below. Without this case an
                    // EMPTY roster serialized fine and every POPULATED one threw
                    // NotSupportedException at the wire boundary, which is why no
                    // headless rig could see it: it took a live save with real
                    // command centres in it.
                    AppendCommandCentreEntry(sb, centreEntry);
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
                case Sitrep.Contract.CommsDegrade degrade:
                    AppendCommsDegrade(sb, degrade);
                    break;
                case Sitrep.Contract.CommsOcclusionBody occlusionBody:
                    // Reached element-by-element from AppendCommsOcclusion's own
                    // loop, and handled here too so a bare entry routed through
                    // AppendValue flattens rather than throwing, same as CommsHop.
                    AppendCommsOcclusionBody(sb, occlusionBody);
                    break;
                // There is deliberately no case for the three provider-private
                // comms payloads (comms.linkQuality / comms.dataRate /
                // comms.linkMargin). Their types live in
                // GonogoRealAntennasUplink.Contract, and a core serializer may
                // not reference an Uplink's assembly, so their producer
                // flattens them to a Dictionary<string, object?> before Publish
                // (RaWire) and they arrive through the IDictionary case below.
                // That is the self-flattening producer boundary every
                // Uplink-owned payload uses.
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
                case Sitrep.Contract.CommandGateReport commandGateReport:
                    // Same "producer owns the flatten" boundary again:
                    // system.uplink.gates' channel source (ChannelEngine's
                    // UplinkGatesTopic mapper) hands back a CommandGateReport
                    // POCO directly. Without these two cases the whole channel
                    // threw NotSupportedException at the wire boundary and every
                    // subscriber got zero stream-data for it, which is the exact
                    // failure PendingUplinkQueue's case above was added for.
                    AppendCommandGateReport(sb, commandGateReport);
                    break;
                case Sitrep.Contract.CommandGate commandGate:
                    AppendCommandGate(sb, commandGate);
                    break;
                case Sitrep.Contract.ChannelEmissionReport channelEmissionReport:
                    // Same "producer owns the flatten" boundary once more:
                    // system.channels' channel source (ChannelEngine's
                    // ChannelsTopic mapper) hands back a ChannelEmissionReport
                    // POCO directly. A diagnostic Topic that threw at the wire
                    // boundary would be the very silence it exists to explain.
                    AppendChannelEmissionReport(sb, channelEmissionReport);
                    break;
                case Sitrep.Contract.ChannelEmissionEntry channelEmissionEntry:
                    AppendChannelEmissionEntry(sb, channelEmissionEntry);
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
                case Sitrep.Contract.ReliabilityBudget reliabilityBudget:
                    // A part's Budgets list routes its elements through here one
                    // by one via the IEnumerable case below, exactly as
                    // reliability.parts already routes ReliabilityPartEntry.
                    AppendReliabilityBudget(sb, reliabilityBudget);
                    break;
                case Sitrep.Contract.RepairCostItem repairCostItem:
                    // A part's RepairCost list routes its elements through here
                    // the same way its Budgets do.
                    AppendRepairCostItem(sb, repairCostItem);
                    break;
                case Sitrep.Contract.RepairOutcome repairOutcome:
                    /*
                     * vessel.repair's reply payload. Not a channel value: it rides
                     * out inside CommandResult<RepairOutcome>.Payload, which
                     * AppendCommandResult writes back through AppendValue, so it
                     * reaches this switch as a raw POCO exactly like a published
                     * one. RepairRefusal.ResultFor sets Payload on EVERY outcome
                     * it is given, success and refusal alike, so without this case
                     * the only vessel.repair reply that survived the wire was the
                     * null-outcome failure.
                     */
                    AppendRepairOutcome(sb, repairOutcome);
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

            // Same rule as breach: only when the refusal actually quotes the
            // game. An empty detail key on every ack would put the shape on the
            // wire for nothing, and an empty STRING reads as a sentence that
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
        /// Flattens a <see cref="Sitrep.Contract.CommsDelay"/> to the wire
        /// object <c>{ oneWaySeconds, source, meta:{ source, quality } }</c>.
        /// <c>oneWaySeconds</c> is nullable (R7 typed absence; see
        /// <see cref="Sitrep.Contract.CommsDelay.OneWaySeconds"/>'s own doc
        /// comment): written as JSON <c>null</c> when there is no measurable
        /// path, the same nullable-double wire path as
        /// <see cref="AppendCommsHop"/>'s <c>distanceMeters</c>, never collapsed
        /// to a 0 sentinel. Enum
        /// values (<c>source</c>, <c>meta.quality</c>) are emitted as their
        /// integer ordinal, the same convention as <c>Meta.quality</c>/
        /// <c>Meta.staleness</c> and <see cref="AppendCommandResult"/>'s
        /// <c>errorCode</c>. See the <c>case</c> in <see cref="AppendValue"/>.
        /// </summary>
        /// <summary>
        /// A gate verdict as <c>{ outcome, errorCode, breach, detail }</c>, both
        /// enums as integer ordinals like every sibling here.
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

            // Unconditional, unlike CommandResult.Detail: this key is not
            // optional in the generated type, and the evaluator's chosen arm is
            // the machine-readable half of the whole verdict.
            sb.Append(',');
            AppendString(sb, "errorCode");
            sb.Append(':');
            AppendInteger(sb, (long)verdict.ErrorCode);

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

        private static void AppendFlightSimulation(StringBuilder sb, Sitrep.Contract.FlightSimulation simulation)
        {
            sb.Append('{');
            AppendString(sb, "simulated");
            sb.Append(':');
            AppendNullableBool(sb, simulation.Simulated);

            sb.Append(',');
            AppendString(sb, "delayApplied");
            sb.Append(':');
            sb.Append(simulation.DelayApplied ? "true" : "false");

            sb.Append(',');
            AppendString(sb, "delayInSimulation");
            sb.Append(':');
            sb.Append(simulation.DelayInSimulation ? "true" : "false");

            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            sb.Append('{');
            AppendString(sb, "source");
            sb.Append(':');
            AppendString(sb, simulation.Meta?.Source ?? "");
            sb.Append(',');
            AppendString(sb, "quality");
            sb.Append(':');
            AppendInteger(sb, (long)(simulation.Meta?.Quality ?? Sitrep.Contract.Quality.OnRails));
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
        /// object <c>{ source, coverage }</c>, plus <c>extensions</c> when a provider
        /// filled its namespace (see <see cref="AppendProviderExtensions"/>, and note
        /// that key is OMITTED rather than null when empty): camelCase keys, JSON
        /// null for absent nullable fields, matching the generated SDK interface.
        /// reliability.summary
        /// (<c>Gonogo.KSP.ReliabilityCoreUplink.HandleOnCourier</c>) publishes this
        /// POCO raw, so before this existed a populated payload threw
        /// <c>NotSupportedException</c> at the wire boundary. See the <c>case</c> in
        /// <see cref="AppendValue"/>.
        /// </summary>
        /// <summary>
        /// Writes <c>vessel.inventory</c> as
        /// <c>{ stores: [...], meta: { source, quality } }</c>.
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
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, inv.Meta);
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

        private static void AppendReliabilitySummary(StringBuilder sb, Sitrep.Contract.ReliabilitySummary r)
        {
            sb.Append('{');
            AppendString(sb, "source");
            sb.Append(':');
            AppendNullableString(sb, r.Source);
            sb.Append(',');
            AppendString(sb, "coverage");
            sb.Append(':');
            AppendNullableString(sb, r.Coverage);
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
        /// object <c>{ partId, title, condition, conditionDetail, survival,
        /// survivalHorizonSeconds, budgets }</c>, plus <c>extensions</c> when a
        /// provider filled its namespace (see
        /// <see cref="AppendProviderExtensions"/>): camelCase keys, JSON null for absent
        /// nullable fields, matching the generated SDK interface. reliability.parts
        /// publishes a <c>List&lt;ReliabilityPartEntry&gt;</c> raw, whose elements
        /// route through here via <see cref="AppendValue"/>'s <c>IEnumerable</c> case.
        ///
        /// <para><c>budgets</c> is written as JSON <c>null</c> when the list is null
        /// and <c>[]</c> when it is empty, deliberately NOT following the
        /// omit-when-empty rule <c>extensions</c> uses: the bag is a mechanism, a
        /// budget list is a reading, and "this provider models no dimensions" is
        /// something a reader is entitled to see.</para>
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
            AppendString(sb, "condition");
            sb.Append(':');
            AppendNullableString(sb, p.Condition);
            sb.Append(',');
            AppendString(sb, "repairTrait");
            sb.Append(':');
            AppendNullableString(sb, p.RepairTrait);
            sb.Append(',');
            AppendString(sb, "repairLevel");
            sb.Append(':');
            AppendNullableNumber(sb, p.RepairLevel);
            sb.Append(',');
            AppendString(sb, "conditionDetail");
            sb.Append(':');
            AppendNullableString(sb, p.ConditionDetail);
            sb.Append(',');
            AppendString(sb, "survival");
            sb.Append(':');
            AppendNullableNumber(sb, p.Survival);
            sb.Append(',');
            AppendString(sb, "survivalHorizonSeconds");
            sb.Append(':');
            AppendNullableNumber(sb, p.SurvivalHorizonSeconds);
            sb.Append(',');
            AppendString(sb, "budgets");
            sb.Append(':');
            if (p.Budgets == null)
            {
                AppendNull(sb);
            }
            else
            {
                sb.Append('[');
                var first = true;
                foreach (var budget in p.Budgets)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    if (budget == null) AppendNull(sb); else AppendReliabilityBudget(sb, budget);
                }
                sb.Append(']');
            }
            sb.Append(',');
            AppendString(sb, "repairCost");
            sb.Append(':');
            /*
             * JSON null when the provider models no consumable cost, never an
             * omitted key. A client's rule turns on telling an absent cost from a
             * zero one, and a key that vanishes takes the distinction with it: an
             * unbroken part and a free repair would arrive byte-identical.
             */
            if (p.RepairCost == null)
            {
                AppendNull(sb);
            }
            else
            {
                sb.Append('[');
                var firstCost = true;
                foreach (var item in p.RepairCost)
                {
                    if (!firstCost) sb.Append(',');
                    firstCost = false;
                    if (item == null) AppendNull(sb); else AppendRepairCostItem(sb, item);
                }
                sb.Append(']');
            }
            AppendProviderExtensions(sb, p.Extensions);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.RepairCostItem"/> to the wire
        /// object <c>{ name, quantity }</c>: camelCase keys in that order, matching
        /// the generated SDK interface and <c>InventoryItem</c>'s own pair so a
        /// client can join the two without translating.
        /// </summary>
        private static void AppendRepairCostItem(StringBuilder sb, Sitrep.Contract.RepairCostItem item)
        {
            sb.Append('{');
            AppendString(sb, "name");
            sb.Append(':');
            AppendString(sb, item.Name);
            sb.Append(',');
            AppendString(sb, "quantity");
            sb.Append(':');
            sb.Append(item.Quantity);
            sb.Append('}');
        }

        /// <summary>
        /// Flattens a <see cref="Sitrep.Contract.ReliabilityBudget"/> to the wire
        /// object <c>{ id, label, kind, consumed, usedSeconds, limitSeconds,
        /// usedCount, limitCount }</c>: camelCase keys, JSON null for absent
        /// nullable fields, in that order, matching the generated SDK interface.
        /// </summary>
        private static void AppendReliabilityBudget(StringBuilder sb, Sitrep.Contract.ReliabilityBudget b)
        {
            sb.Append('{');
            AppendString(sb, "id");
            sb.Append(':');
            AppendNullableString(sb, b.Id);
            sb.Append(',');
            AppendString(sb, "label");
            sb.Append(':');
            AppendNullableString(sb, b.Label);
            sb.Append(',');
            AppendString(sb, "kind");
            sb.Append(':');
            AppendNullableString(sb, b.Kind);
            sb.Append(',');
            AppendString(sb, "consumed");
            sb.Append(':');
            AppendNullableNumber(sb, b.Consumed);
            sb.Append(',');
            AppendString(sb, "usedSeconds");
            sb.Append(':');
            AppendNullableNumber(sb, b.UsedSeconds);
            sb.Append(',');
            AppendString(sb, "limitSeconds");
            sb.Append(':');
            AppendNullableNumber(sb, b.LimitSeconds);
            sb.Append(',');
            AppendString(sb, "usedCount");
            sb.Append(':');
            AppendNullableNumber(sb, b.UsedCount);
            sb.Append(',');
            AppendString(sb, "limitCount");
            sb.Append(':');
            AppendNullableNumber(sb, b.LimitCount);
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
        /// Flattens a <see cref="Sitrep.Contract.CommandGateReport"/> to the
        /// wire object <c>{ gates: [...] }</c>. See the <c>case</c> in
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
            sb.Append('}');
        }

        /// <summary>
        /// Flattens one <see cref="Sitrep.Contract.CommandGate"/> to
        /// <c>{ command, verdict }</c>, the verdict through the same
        /// <see cref="AppendGateVerdict"/> a refused dispatch uses, so a client
        /// reads one shape whether the gate answered in advance or at dispatch.
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
        /// written unconditionally, including the zeros and the falses: this
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
        // and zero stream-data, exactly the processor-listing / comms.delay bug.
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
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, c.Meta);
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
        /// One <c>commandCentre.roster</c> entry as <c>{ id, displayName, kind,
        /// bodyIndex, latitude, longitude, active, delayQuality }</c>, camelCase
        /// keys in the contract's own declaration order.
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
            AppendString(sb, "delayQuality");
            sb.Append(':');
            AppendNullableString(sb, e.DelayQuality);
            sb.Append('}');
        }

        /// <summary>
        /// A repair attempt's outcome as <c>{ repaired, refusal, kitsUsed,
        /// kitsFrom }</c>, the payload half of <c>vessel.repair</c>'s reply.
        /// </summary>
        ///
        /// <remarks>
        /// <c>refusal</c> is written as JSON null on success rather than as an
        /// empty string, because it is the FINER half of a refusal and an empty
        /// token would read as a reason that came back blank. The client's rule
        /// turns on its presence.
        /// </remarks>
        private static void AppendRepairOutcome(
            StringBuilder sb, Sitrep.Contract.RepairOutcome o)
        {
            sb.Append('{');
            AppendString(sb, "repaired");
            sb.Append(':');
            AppendBool(sb, o.Repaired);
            sb.Append(',');
            AppendString(sb, "refusal");
            sb.Append(':');
            AppendNullableString(sb, o.Refusal);
            sb.Append(',');
            AppendString(sb, "kitsUsed");
            sb.Append(':');
            AppendInteger(sb, o.KitsUsed);
            sb.Append(',');
            AppendString(sb, "kitsFrom");
            sb.Append(':');
            AppendNullableString(sb, o.KitsFrom);
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
            // Omitted entirely when no provider filled a bag, so a bare-CommNet hop
            // is byte-for-byte what it was before the bag existed (see
            // AppendProviderExtensions).
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
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, o.Meta);
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
            sb.Append(',');
            AppendString(sb, "meta");
            sb.Append(':');
            AppendPayloadMeta(sb, d.Meta);
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

        // RaWire (beside the Uplink that publishes comms.linkQuality /
        // comms.dataRate / comms.linkMargin) builds those payload objects
        // itself, because their types live in GonogoRealAntennasUplink.Contract
        // and this file cannot reference them. AppendPayloadMeta above is what
        // RaWire mirrors for the nested meta object, quality as its integer
        // ordinal included: the two must agree.

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
