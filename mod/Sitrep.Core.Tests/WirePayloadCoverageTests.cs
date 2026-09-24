using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// GENERAL guard against the "subscribed but no stream-data" bug class: a
    /// payload type published to the wire as a RAW POCO with no
    /// <see cref="JsonWriter.AppendValue"/> case compiles fine but throws
    /// <c>NotSupportedException</c> at the wire boundary at runtime, and the
    /// frame is silently dropped, the client sees only "subscribed".
    ///
    /// <para>This enumerates every <see cref="SitrepContractAttribute"/>-marked
    /// concrete class in the contract assembly and asserts each serializes
    /// through the REAL stream-data wire path (<see cref="EnvelopeCodec.WriteStreamData"/>
    /// → <see cref="JsonWriter"/>) without hitting the switch's default-throw.
    /// A "forgot a JsonWriter case" is therefore a RED test, not a silent live
    /// frame-drop.</para>
    ///
    /// <para>Polarity: types are IN by default, and a type is out only when
    /// <see cref="Excused"/> says so. Two of that method's three answers are
    /// DERIVED rather than claimed: a <see cref="SitrepCommandAttribute"/> on the
    /// declaration means the type is a command's arguments and travels inbound
    /// only, and <see cref="ProducerFieldParityTests"/> finds the method that
    /// hand-flattens a type to a <c>Dictionary&lt;string, object?&gt;</c> and
    /// holds it to every field of that type. The third is the residual
    /// <see cref="FlattenedByProducer"/> list, which is what neither reading can
    /// reach yet; see its own comment. Any NEW raw-published payload type is
    /// caught automatically: nothing excuses it, so a missing case fails here.</para>
    /// </summary>
    public class WirePayloadCoverageTests
    {
        /// <summary>
        /// What is left of the hand-written exclusion list, and it is a RESIDUE
        /// rather than the mechanism: <see cref="Excused"/> now derives most
        /// entries automatically instead of taking them on claim.
        ///
        /// <para>An entry here was never coverage. It said "some producer
        /// flattens this type" and reflection cannot grade a claim. What used
        /// to be claimed by hand is now derived: <see cref="SitrepCommandAttribute"/>
        /// is the declaration's own statement that a type is a command's
        /// arguments and therefore inbound only, and the producer scan finds
        /// the flattening method and holds it to every field of the type it
        /// stands for, so the exclusion and the parity check now come from the
        /// same reading of the same source.</para>
        ///
        /// <para>What survives is the two shapes that reading cannot reach, and
        /// they are grouped by which. NOTHING here is a licence: the goal is
        /// still an empty list, and the way to shrink it further is to make the
        /// scan able to name these producers, never to add to it.</para>
        /// </summary>
        private static readonly HashSet<string> FlattenedByProducer = new()
        {
            // ── Envelope and meta ────────────────────────────────────────────
            // Not payloads at all: EnvelopeCodec writes each of these
            // field-by-field itself (WriteStreamData / WriteMeta / the control
            // frames), so none ever reaches the payload switch. PayloadMeta is
            // NOT here any more, it has a real flattener (VesselViewProvider.
            // ToWire(PayloadMeta)) and the scan grades it.
            "Meta", "ErrorMsg", "EventMsg", "Subscribe", "Unsubscribe", "SetVantage",
            // A control frame like the six above: EnvelopeCodec.WriteCommandAccepted
            // writes its two fields itself, and it is never a channel payload,
            // so it cannot reach the payload switch.
            "CommandAccepted",
            // The binary lane's header, on the same footing: BinaryFrameCodec
            // frames it and EnvelopeCodec.WriteStreamBinaryHeader writes the
            // JSON half field-by-field, so it never reaches the payload switch
            // either. Its own payload is bytes, which by construction is what
            // the lane exists to keep OUT of JsonWriter.
            "StreamBinary",

            // ── Flattened by a producer the scan cannot NAME ─────────────────
            // Every type below is genuinely hand-flattened before Publish. What
            // the scan needs and does not have is a method that stands for the
            // type: each of these is built inline inside its parent's producer
            // (an element written in a `foreach` that has no method of its own),
            // or by a method whose name and class do not spell the type between
            // them. Two live examples of the second: `CareerViewProvider.
            // BuildCareer` produces `career.status` (the class and the method
            // spell "Career" twice and "CareerStatus" never), and
            // `Sitrep.Host.Crash.CrashPayload.Build` produces `CrashReport`.
            //
            // career.status: CareerViewProvider.BuildCareer returns the
            // Dictionary<string, object?> tree, and BuildEconomy/BuildContracts/
            // BuildStrategies/BuildTech fill its four groups. Those four ARE
            // graded; the wrapper and the nested rows under them are not.
            "CareerStatus", "CareerUpkeep", "CareerFacility",
            "CareerContract", "CareerContractParameter", "CareerStrategy", "CareerTechNode",
            // fleet.silence: FleetSilenceRosterBuilder wraps per-vessel entries
            // (reused from FleetVesselSilenceBuilder, which IS graded) in a
            // { vessels: [...] } dictionary.
            "FleetSilence", "FleetSilenceEntry",
            // currency.<guid>.science: CurrencyEventBuilder.BuildScienceCredit
            // and its reputation sibling return the flattened dictionary that
            // CurrencyEventUplink publishes.
            "ScienceCreditEvent", "ReputationLossEvent",
            // crash.lastCrash: Sitrep.Host.Crash.CrashPayload.Build hand-builds
            // the whole tree, parts-lost rows and flight stats included.
            "CrashReport", "CrashPartLost", "CrashFlightStats",
            // recovery.lastSummary: Sitrep.Host.Recovery.RecoveryPayload.Build,
            // the same shape as the crash payload beside it.
            "RecoveryReport", "RecoveryScienceEntry", "RecoveryPartEntry",
            "RecoveryResourceEntry", "RecoveryCrewEntry",
            // spaceCenter.*: SpaceCenterViewProvider's Build* helpers emit these
            // as rows inside the list they return. BuildScene and
            // BuildPartsAvailable name their types and ARE graded.
            "LaunchSiteEntry", "CrewRosterEntry", "SavedShipEntry",
            "AstronautComplexInfo", "SpaceCenterPoiEntry",
            // dv.stages: StageDeltaVViewProvider.BuildStages writes each stage
            // inline; its BuildSummary sibling is graded.
            "StageDeltaVEntry",
            // system.bodies / system.vessels / target.available: the roots are
            // graded (SystemViewProvider.BuildSystemBodies and friends); these
            // are the rows and sub-objects those roots assemble from the raw
            // capture's flat keys, with no method of their own.
            "BodyEntry", "AtmosphereEntry", "OrbitEntry", "VesselRosterEntry", "TargetListEntry",
            // robotics.available: BreakingGroundViewProvider builds this tree
            // without a method named for it.
            "RoboticsAvailability",
            // system.uplink.pending: PendingUplink is only ever an element of
            // PendingUplinkQueue.Pending, written by AppendPendingUplinkQueue's
            // own loop through AppendPendingUplink, never handed to AppendValue
            // on its own. The queue itself is NOT excused: it is published raw,
            // has its own JsonWriter case, and this test exercises it.
            "PendingUplink",
        };

        /// <summary>
        /// Whether this type is legitimately never handed to
        /// <see cref="JsonWriter.AppendValue"/> as a raw POCO.
        /// </summary>
        internal static bool Excused(Type type) =>
            type.IsDefined(typeof(SitrepCommandAttribute), false)
            || InboundCommandElements.Value.Contains(type)
            || ProducerFieldParityTests.HandFlattenedTypes().Contains(type.Name)
            || FlattenedByProducer.Contains(type.Name);

        /// <summary>
        /// The element types of a list a command's arguments carry. They arrive
        /// inside those arguments and are never published, so they owe the writer
        /// nothing, and a type found here needs no entry in the hand list above.
        /// </summary>
        private static readonly Lazy<HashSet<Type>> InboundCommandElements = new(() =>
            new HashSet<Type>(
                typeof(CommsDelay).Assembly.GetTypes()
                    .Where(t => t.IsDefined(typeof(SitrepCommandAttribute), false))
                    .SelectMany(t => t.GetProperties())
                    .Select(p => ElementTypeOf(p.PropertyType))
                    .Where(e => e != null)
                    .Select(e => e!)));

        private static Type? ElementTypeOf(Type type)
        {
            if (type.IsArray)
            {
                return type.GetElementType();
            }

            return type.IsGenericType && type.GetGenericArguments().Length == 1
                && typeof(System.Collections.IEnumerable).IsAssignableFrom(type)
                ? type.GetGenericArguments()[0]
                : null;
        }

        private static IEnumerable<Type> ContractPayloadTypes() =>
            typeof(CommsDelay).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition)
                // [SitrepContract] is the contract's own marker, applied alongside
                // every codegen attribute (see Sitrep.Contract.Codegen).
                .Where(t => t.IsDefined(typeof(SitrepContractAttribute), false))
                .Where(t => t.GetConstructor(Type.EmptyTypes) != null);

        internal static void SerializeThroughWire(object payload)
        {
            var msg = new StreamData<object?>
            {
                Type = "stream-data",
                Topic = "coverage",
                Payload = payload,
                Meta = new Meta
                {
                    Source = "s", ValidAt = 0, Seq = 1, DeliveredAt = 0, Vantage = "v",
                    Quality = Quality.OnRails, Active = true, Staleness = Staleness.Fresh,
                    TimelineEpoch = 0,
                },
            };
            EnvelopeCodec.WriteStreamData(msg);
        }

        /// <summary>
        /// The payload-type discovery reaches the contract, so a clean sweep means
        /// something.
        ///
        /// <para><see cref="EveryRawPublishedContractTypeHasAJsonWriterCase"/> reports
        /// nothing missing over an empty type list, which is the same answer it gives
        /// for a fully covered one. <c>CommsPayloadsAreCovered_NotAllowlisted</c> is a
        /// real control for the seven comms types and leaves the rest of the ~200-type
        /// surface, and the <c>FlattenedByProducer</c> allowlist that forces a decision
        /// on each NEW type, resting on this discovery holding.</para>
        /// </summary>
        [Fact]
        public void DiscoveryReachesTheContractPayloadTypes()
        {
            var found = ContractPayloadTypes().Select(t => t.Name).ToList();
            Assert.True(
                found.Count >= 100,
                "Contract payload discovery collapsed to " + found.Count
                    + " types, so the wire sweep is covering almost nothing. Found: "
                    + string.Join(", ", found.OrderBy(x => x)));
        }

        [Fact]
        public void EveryRawPublishedContractTypeHasAJsonWriterCase()
        {
            var missing = new List<string>();
            foreach (var t in ContractPayloadTypes())
            {
                // Every type is TRIED, and only a type that could not be
                // written is then asked whether it is excused. Trying first
                // costs nothing and means an excuse can never take away
                // coverage that exists: a type both flattened by a producer
                // AND published raw somewhere else (InventoryItem is one)
                // still keeps its case, rather than losing it the moment
                // someone adds an excuse entry for it.
                var inst = Activator.CreateInstance(t)!;
                try
                {
                    SerializeThroughWire(inst);
                }
                catch (NotSupportedException)
                {
                    if (!Excused(t))
                    {
                        missing.Add(t.Name);
                    }
                }
            }

            Assert.True(
                missing.Count == 0,
                "These [SitrepContract] payload types have no JsonWriter case and would be silently dropped at the wire boundary if published raw. Add an AppendValue case + Append<Type> helper (mirror AppendCommsDelay), or, if the type is genuinely never handed to AppendValue raw, make Excused able to SEE that: a command's args carry [SitrepCommand], and a hand-flattened type is found by ProducerFlattenScan, which then also holds its producer to every field. The residual FlattenedByProducer list is the last resort and is meant to shrink: "
                    + string.Join(", ", missing));
        }

        /// <summary>
        /// <c>CommandCentreEntry</c> and <c>RepairOutcome</c>, in the shapes their
        /// producers actually publish rather than as bare default instances.
        ///
        /// <para>Neither is hand-flattened by its producer: the roster's entry is
        /// built as a POCO by <c>CommandCentreDelayUplink.ToRosterEntry</c> and the
        /// publisher hands the list straight over, and the repair outcome rides
        /// back through <see cref="JsonWriter.AppendValue"/> inside
        /// <c>CommandResult&lt;T&gt;.Payload</c>, not flattened. An allowlist entry
        /// is a human claim, and the sweep above cannot grade one; these two are
        /// asserted NOT allowlisted so a false claim cannot come back.</para>
        ///
        /// <para>The roster is exercised POPULATED, which is the whole reason this
        /// exists: an empty <c>List&lt;CommandCentreEntry&gt;</c> serializes to
        /// <c>[]</c> without the element type ever reaching the payload switch, so
        /// every headless rig and every save without real command centres in it
        /// read healthy.</para>
        /// </summary>
        [Fact]
        public void CommandCentreRosterAndRepairOutcomeAreCovered_NotAllowlisted()
        {
            foreach (var type in new[] { typeof(CommandCentreEntry), typeof(RepairOutcome) })
            {
                // Excused rather than the hand list alone: an entry is no longer
                // the only way a type can be let off, so asserting only against
                // the list would leave the derived arms free to excuse these two
                // by a different wrong route.
                Assert.False(Excused(type),
                    $"{type.Name} must NOT be excused, it reaches JsonWriter.AppendValue as a raw POCO.");
            }

            SerializeThroughWire(new List<CommandCentreEntry>
            {
                new CommandCentreEntry
                {
                    Id = "ksc",
                    DisplayName = "Kerbal Space Center",
                    Kind = "GroundStation",
                    BodyIndex = 1,
                    Latitude = -0.0972,
                    Longitude = -74.5577,
                    Active = true,
                    DelayQuality = "routed",
                },
            });

            SerializeThroughWire(
                RepairRefusal.ResultFor(new RepairOutcome { Repaired = true, KitsUsed = 1, KitsFrom = "carried" }));
            SerializeThroughWire(
                RepairRefusal.ResultFor(new RepairOutcome { Repaired = false, Refusal = RepairRefusal.NoKits }));
        }

        [Fact]
        public void CommsPayloadsAreCovered_NotAllowlisted()
        {
            // These types are asserted covered AND asserted NOT hidden behind
            // the allowlist, so this test genuinely exercises them: it would
            // go RED if any of their JsonWriter cases were removed.
            foreach (var name in new[]
                     {
                         nameof(CommsConnectivity), nameof(CommsSignal),
                         nameof(CommsControl), nameof(CommsPath), nameof(CommsNetwork),
                         nameof(CommsDelay), nameof(CommsOcclusion),
                     })
            {
                Assert.False(Excused(typeof(CommsDelay).Assembly.GetType("Sitrep.Contract." + name, throwOnError: true)!),
                    $"{name} must NOT be excused, it is published raw and must have a JsonWriter case exercised by the coverage test.");
            }

            // And they serialize without throwing.
            SerializeThroughWire(new CommsConnectivity());
            SerializeThroughWire(new CommsSignal());
            SerializeThroughWire(new CommsControl());
            SerializeThroughWire(new CommsPath());
            SerializeThroughWire(new CommsNetwork());
            SerializeThroughWire(new CommsDelay());
            SerializeThroughWire(new CommsOcclusion
            {
                ModelId = "commnet-scaled-radius",
                ModelName = "Stock CommNet (occlusion multipliers)",
                Bodies = new List<CommsOcclusionBody>
                {
                    // A populated body, not just the empty default: the nested
                    // list is where a missing writer helper would actually bite.
                    new CommsOcclusionBody
                    {
                        Index = 1,
                        Name = "Kerbin",
                        RadiusMeters = 600_000,
                        HasAtmosphere = true,
                        OccludingRadiusMeters = 450_000,
                    },
                },
            });
        }
    }
}
