#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace Gonogo.KosUplink;

/// <summary>
/// This Uplink's OWN codegen configuration: mirrors
/// <c>Sitrep.Contract.RtConfig.Configure</c>'s shape exactly, scoped to just
/// this assembly's eleven wire types, and reuses
/// <c>RtConfig.ApplyUnitValueTypes</c> the same way each earlier relocated
/// Uplink's own <c>Configure</c> does (the uplink-types-out-of-core plan's
/// mechanism, unchanged here; the plan doc names the five earlier steps, this
/// file does not, since naming a sibling Uplink would trip ITS own frontend
/// uplink-boundary token).
///
/// <para><b>One Topic-tagged root out of eleven types, which is the lowest
/// ratio of any relocated slice.</b> Only <see cref="KosProcessorInfo"/> carries
/// <c>[SitrepTopic]</c> (<c>kos.processors</c>, <c>isArray</c>), so
/// <c>EmitTopicMap</c> is wired below but names exactly one entry. The other ten
/// are not nested shapes either, which is what makes this slice structurally
/// unlike its predecessors: they are the payloads of DYNAMIC channels and
/// commands, which by construction cannot carry a static <c>[SitrepTopic]</c>
/// name.
/// <list type="bullet">
/// <item><see cref="KosTerminalFrame"/> rides
/// <c>kos.terminal.&lt;coreId&gt;</c> and <see cref="KosRunResult"/> rides
/// <c>kos.run.&lt;coreId&gt;</c>: one channel per CPU, the id known only at
/// runtime, so there is no fixed Topic string to tag.</item>
/// <item><see cref="KosComputeStatus"/> rides
/// <c>kos.compute.&lt;id&gt;.status</c>, the same shape of dynamic name keyed by
/// compute-topic id instead.</item>
/// <item>The remaining seven are command ARGS (<c>kos.exec</c>,
/// <c>kos.reEnable</c>, <c>kos.terminal.open</c>/<c>.resize</c>/<c>.close</c>,
/// <c>kos.keystroke</c>, <c>kos.run</c>), inbound-only by definition.</item>
/// </list>
/// </para>
///
/// <para><b>Eight of the eleven are inbound-only, so
/// <c>ApplyUnitValueTypes</c> skips most of this slice.</b> Its <c>"Args"</c>
/// suffix rule (see its own doc comment: a widget JSON-stringifies command args
/// straight to the wire and there is no unwrap step coming back) means
/// <see cref="KosExecArgs"/>, <see cref="KosReEnableArgs"/>,
/// <see cref="KosRunArgs"/>, <see cref="KosTerminalOpenArgs"/>,
/// <see cref="KosKeystrokeArgs"/>, <see cref="KosTerminalResizeArgs"/> and
/// <see cref="KosTerminalCloseArgs"/> keep bare properties. That is the highest
/// proportion of args in any relocated slice, and it is worth stating plainly
/// because it is why the retyping this call exists to perform is nearly invisible
/// here.</para>
///
/// <para><b>Exactly ONE declared quantity survives to a
/// <c>Value&lt;&gt;</c> in this whole slice</b>, and the honest accounting
/// matters more than the mechanism: <see cref="KosComputeStatus.LastGoodAt"/>
/// (<c>Units.Seconds</c> -&gt; <c>Value&lt;"s"&gt;</c>). Every OTHER annotated
/// property on the three outbound types declares a NON-QUANTITY token, which
/// <c>ApplyUnitValueTypes</c> leaves bare by design:
/// <see cref="KosProcessorInfo"/> is six <c>Id</c>/<c>Text</c>/<c>Flag</c>
/// fields, <see cref="KosTerminalFrame"/> three, <see cref="KosRunResult"/>
/// three plus an unannotated field map. A kOS CPU list is identifiers and
/// state names; there are no magnitudes in it to carry. So this slice's
/// generated <c>units.ts</c> is real and correct and its decode-time effect is
/// almost nil, which is stated here rather than left to be discovered as a
/// suspected bug.</para>
///
/// <para><b>No nested payload types at all.</b> No property on any of the
/// eleven holds another contract shape, so <c>EmitUnitMap</c>'s field -&gt;
/// nested-type SHAPE half comes out empty here, which the later relocations had
/// all needed (naming which ones would trip THEIR own frontend
/// uplink-boundary token from this file, so the plan doc is the
/// cross-reference). <see cref="KosRunResult.Fields"/> is the closest thing and is
/// deliberately NOT a shape: it is a <c>Dictionary&lt;string, object?&gt;</c>
/// carrying whatever a script printed, which is exactly why it declares no
/// unit.</para>
///
/// <para>Invoked by <c>mod/codegen.sh</c>'s per-uplink codegen step, writing
/// into <c>mod/GonogoKosUplink/client/src/__generated__/</c>, never into
/// <c>sitrep-sdk</c>.</para>
///
/// <para><b>Runtime hydration, not just codegen.</b> A relocated Topic's
/// declared units also have to reach <c>wrapTopicPayload</c>'s runtime lookup
/// (<c>sitrep-sdk</c>'s <c>unitsForTopic</c>/<c>shapesForTopic</c>), which used
/// to read <c>kos.processors</c> straight out of the SDK's own generated map
/// because these types lived in <c>Sitrep.Contract</c>. It does not any more, so
/// this Uplink's client package (<c>topics.ts</c>) calls the SDK's
/// <c>registerTopicUnits</c> AND <c>registerTypeUnits</c> at module load, feeding
/// them the maps this Configure emits below. Both halves are wired for the same
/// reason the loop form was chosen over naming entries: what needs registering
/// follows from the generated maps, so the next annotated field on this contract
/// is covered without a new call site. What they carry TODAY is the accounting
/// above, and the Uplink's own <c>topics.test.ts</c> asserts the registry
/// contents rather than a decode-time hydration this slice cannot yet
/// demonstrate.</para>
/// </summary>
public static class KosRtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true)
            .AutoOptionalProperties());

        // Held in a local for the same reason RtConfig.wirePayloadTypes is:
        // ApplyUnitValueTypes re-enters this exact set, only a type
        // registered with rtcli may have its properties retyped.
        var wireTypes = new[]
        {
            // kos.processors: the CPU discovery channel, the one [SitrepTopic]
            typeof(KosProcessorInfo),
            // kos.compute.<id>.status: out-of-band status for one compute topic
            typeof(KosComputeStatus),
            // kos.exec / kos.dispatchNow / kos.reEnable command args
            typeof(KosExecArgs),
            typeof(KosReEnableArgs),
            // kos.terminal.<coreId> interactive terminal, downlink frame + command args
            typeof(KosTerminalFrame),
            typeof(KosTerminalOpenArgs),
            typeof(KosKeystrokeArgs),
            typeof(KosTerminalResizeArgs),
            typeof(KosTerminalCloseArgs),
            // kos.run.<coreId> ad-hoc RPC, command args + result
            typeof(KosRunArgs),
            typeof(KosRunResult),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        // Same call core's own Configure makes, just against THIS assembly's
        // types and pointed at the npm package this Uplink's generated file
        // actually imports from (a relative "../value" path, core's default,
        // would not resolve from
        // mod/GonogoKosUplink/client/src/__generated__/).
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        // One of the eleven carries [SitrepTopic], so there IS a topic to name
        // here, unlike a command-arg-only slice.
        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_KOS_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(KosRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_KOS_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_KOS_UNITJSON_OUT"),
                typeof(KosRtConfig).Assembly);
        }
    }
}
#endif
