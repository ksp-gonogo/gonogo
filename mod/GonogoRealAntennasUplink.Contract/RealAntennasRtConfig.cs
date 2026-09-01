#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace Gonogo.RealAntennasUplink;

/// <summary>
/// This Uplink's OWN codegen configuration: mirrors
/// <c>Sitrep.Contract.RtConfig.Configure</c>'s shape exactly, scoped to just
/// this assembly's three wire types, and reuses
/// <c>RtConfig.ApplyUnitValueTypes</c> the same way each earlier relocated
/// Uplink's own <c>Configure</c> does (the uplink-types-out-of-core plan's
/// mechanism, unchanged here; the plan doc names the six earlier steps, this
/// file does not, since naming a sibling Uplink would trip ITS own frontend
/// uplink-boundary token).
///
/// <para><b>Three types, three Topic-tagged roots, which is the highest ratio
/// of any relocated slice.</b> Every type here carries <c>[SitrepTopic]</c>
/// (<c>comms.linkQuality</c>, <c>comms.dataRate</c>, <c>comms.linkMargin</c>),
/// so <c>EmitTopicMap</c> names all three. There are no command args at all in
/// this slice: these channels are read-only observations, and the only thing a
/// client ever does with RealAntennas is look at it. Nothing nests either, so
/// <c>EmitUnitMap</c>'s field -&gt; nested-type SHAPE half comes out empty; the
/// one nested shape in the comms family, <c>CommsHop</c>, hangs off
/// <c>CommsPath</c> and stays core with it.</para>
///
/// <para><b>Every declared quantity here is real, which is what makes this
/// slice the mirror image of the one before it.</b> All four annotated
/// properties name a dimension the unit model resolves:
/// <see cref="CommsLinkQuality.Value"/> (<c>Units.Ratio</c>),
/// <see cref="CommsDataRate.UpBitsPerSec"/> and
/// <see cref="CommsDataRate.DownBitsPerSec"/>
/// (<c>Units.BitsPerSecond</c>), and <see cref="CommsLinkMargin.DecibelMargin"/>
/// (<c>Units.Decibels</c>). Only <see cref="CommsLinkMargin.ClosesLink"/> is a
/// non-quantity (<c>Units.Flag</c>), and it is a bool. So the retyping this call
/// exists to perform is visible in every one of the three generated interfaces,
/// and the runtime hydration below can be proved by DECODING a frame rather than
/// by inspecting a registry.</para>
///
/// <para>Invoked by <c>mod/codegen.sh</c>'s per-uplink codegen step, writing
/// into <c>mod/GonogoRealAntennasUplink/client/src/__generated__/</c>, never
/// into <c>sitrep-sdk</c>.</para>
///
/// <para><b>Runtime hydration, not just codegen.</b> A relocated Topic's
/// declared units also have to reach <c>wrapTopicPayload</c>'s runtime lookup
/// (<c>sitrep-sdk</c>'s <c>unitsForTopic</c>/<c>shapesForTopic</c>), which used
/// to read these three straight out of the SDK's own generated map because the
/// types lived in <c>Sitrep.Contract</c>. It does not any more, so this Uplink's
/// client package (<c>topics.ts</c>) calls the SDK's <c>registerTopicUnits</c>
/// AND <c>registerTypeUnits</c> at module load, feeding them the maps this
/// Configure emits below. Both halves are wired even though nothing in this
/// slice nests today: the loop form means the next annotated field on this
/// contract is covered without a new call site.</para>
/// </summary>
public static class RealAntennasRtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true)
            .AutoOptionalProperties()
            // Carry this slice's `///` prose onto its generated declarations, the
            // same way core does. See Sitrep.Contract.RtDocVisitor.
            .GenerateDocumentation()
            .UseVisitor<Sitrep.Contract.RtDocVisitor>());

        Sitrep.Contract.RtDocText.MergeRemarksIntoSummaries(builder);

        // Held in a local for the same reason RtConfig.wirePayloadTypes is:
        // ApplyUnitValueTypes re-enters this exact set, only a type
        // registered with rtcli may have its properties retyped.
        var wireTypes = new[]
        {
            // comms.linkQuality: link margin normalised to 0..1
            typeof(CommsLinkQuality),
            // comms.dataRate: bidirectional throughput off the RA graph
            typeof(CommsDataRate),
            // comms.linkMargin: re-derived link budget, dB + does-it-close
            typeof(CommsLinkMargin),
            // The RealAntennas namespace of CommsHop's provider extension bag. No
            // [SitrepTopic] (it is a nested bag type, reached through comms.path's
            // hops, not a channel of its own), so EmitTopicMap ignores it while
            // ApplyUnitValueTypes still retypes its annotated quantities and the
            // TYPE unit/shape maps carry it for the client's hydration walk.
            typeof(RealAntennasHopExt),
            // The element type of realantennas.hopRates. Like the bag above it
            // carries no [SitrepTopic] (the channel value is a bare ARRAY of these,
            // registered client-side as a bare-primitive topic + a declare-module
            // augmentation to RealAntennasHopRate[]), but it MUST be listed so
            // AutoI(false) keeps its generated name and ApplyUnitValueTypes retypes
            // BitsPerSec to Value<"bit/s"> instead of leaving it a bare number.
            typeof(RealAntennasHopRate),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        // Same call core's own Configure makes, just against THIS assembly's
        // types and pointed at the npm package this Uplink's generated file
        // actually imports from (a relative "../value" path, core's default,
        // would not resolve from
        // mod/GonogoRealAntennasUplink/client/src/__generated__/).
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        // PayloadMeta is a CORE type these payloads carry, and this is the first
        // relocated slice to carry one at all: every earlier Uplink's types were
        // either flat DTOs or command args with no envelope-adjacent field. rtcli
        // only knows the types this run exports, so a property whose type lives in
        // Sitrep.Contract resolves to `any` with a RT0003 warning, which would
        // hand the client an untyped `meta` on all three channels and lose the
        // source/quality pair every consumer reads. Pointing it at the SDK's
        // already-generated PayloadMeta is the same move ApplyUnitValueTypes makes
        // for Value/Vec3Of just above: the core shape is imported, never
        // re-declared, so there is exactly one definition of it on the client.
        builder.AddImport("{ PayloadMeta }", "@ksp-gonogo/sitrep-sdk");
        foreach (var type in wireTypes)
        {
            var meta = type.GetProperty("Meta");
            if (meta == null)
            {
                continue;
            }

            builder.ExportAsInterfaces(
                new[] { type },
                c => c.WithProperties(new[] { meta }, p => p.Type("PayloadMeta")));
        }

        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_REALANTENNAS_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(RealAntennasRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_REALANTENNAS_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_REALANTENNAS_UNITJSON_OUT"),
                typeof(RealAntennasRtConfig).Assembly);
        }
    }
}
#endif
