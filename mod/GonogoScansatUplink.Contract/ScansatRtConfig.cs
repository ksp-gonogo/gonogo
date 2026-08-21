#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace GonogoScansatUplink;

/// <summary>
/// This Uplink's OWN codegen configuration: mirrors
/// <c>Sitrep.Contract.RtConfig.Configure</c>'s shape exactly, scoped to just
/// this assembly's five wire types, and reuses
/// <c>RtConfig.ApplyUnitValueTypes</c> the same way each earlier relocated
/// Uplink's own <c>Configure</c> does (the uplink-types-out-of-core plan's
/// mechanism, unchanged here; the plan doc names the three earlier steps, this
/// file does not, since naming a sibling Uplink would trip ITS own frontend
/// uplink-boundary token).
///
/// <para><b>The first relocation with NESTED payload types.</b> Every
/// predecessor moved flat DTOs. <see cref="ScanningVesselEntry"/> carries
/// <c>List&lt;ScanSensorEntry&gt; Sensors</c> and <c>ScanTrackColor
/// TrackColor</c>, so the generated artifact this Uplink needs is not just a
/// unit map but a SHAPE map too (<c>GENERATED_TOPIC_SHAPES</c>: field name ->
/// nested type name), which is how <c>wrapTopicPayload</c> knows to recurse
/// into each sensor's <c>fov</c>/<c>minAlt</c>/<c>maxAlt</c>/<c>bestAlt</c>
/// rather than stopping at the array. <c>RtConfig.EmitUnitMap</c> already emits
/// both halves from one reflection pass, so this Configure needs no extra call,
/// but the runtime registration in this Uplink's client
/// (<c>registerTopicUnits(topic, units, shapes)</c>) MUST pass the shapes
/// argument, not just the units, or the nested quantities silently arrive bare.
/// </para>
///
/// <para><b>Two Topic-tagged roots, both arrays.</b>
/// <see cref="ScanningVesselEntry"/> is tagged
/// <c>[SitrepTopic("scansat.scanningVessels", isArray: true)]</c> and
/// <see cref="ScanScienceEntry"/> <c>[SitrepTopic("scansat.science",
/// isArray: true)]</c>, so <c>EmitTopicMap</c> is wired below and names both.
/// (An Uplink whose whole contract slice is inbound-only command args has no
/// Topic to name and skips that call; two of the plan's earlier steps were in
/// that position.)
/// <see cref="ScanAnomalyEntry"/> deliberately carries NO
/// <c>[SitrepTopic]</c>: <c>scansat.anomalies.&lt;body&gt;</c> is a dynamic
/// per-body namespace the client subscribes to by runtime-computed string (see
/// that type's own doc comment), so it exists purely to give the array element
/// shape a name. <see cref="ScanSensorEntry"/>/<see cref="ScanTrackColor"/> are
/// nested-only, likewise untagged.</para>
///
/// <para>None of these five types has a name ending in <c>"Args"</c>, so
/// <c>ApplyUnitValueTypes</c> retypes the quantity properties on ALL of them:
/// there is no inbound-only member of this set for it to skip, unlike the
/// command-arg slices earlier in the plan. See
/// <c>generated-value-import.test.ts</c> in this Uplink's client package, which
/// asserts the emitted import non-vacuously (the degrees/metres fields on
/// ScanningVesselEntry and ScanSensorEntry make it so).</para>
///
/// <para>Invoked by <c>mod/codegen.sh</c>'s per-uplink codegen step, writing
/// into <c>mod/GonogoScansatUplink/client/src/__generated__/</c>, never into
/// <c>sitrep-sdk</c>.</para>
///
/// <para><b>Runtime hydration, not just codegen.</b> A relocated Topic's
/// declared units also have to reach <c>wrapTopicPayload</c>'s runtime lookup
/// (<c>sitrep-sdk</c>'s <c>unitsForTopic</c>/<c>shapesForTopic</c>), which
/// used to read <c>scansat.scanningVessels</c>/<c>scansat.science</c> straight
/// out of the SDK's own generated map because these types lived in
/// <c>Sitrep.Contract</c>. They do not any more, so this Uplink's client
/// package (<c>topics.ts</c>) now calls the SDK's <c>registerTopicUnits</c> at
/// module load, feeding it the UNIT and SHAPE maps this Configure emits below
/// (see that file's comment for why: <c>ApplyUnitValueTypes</c> only fixes the
/// codegen-time TYPE, not the decode-time VALUE). Without this,
/// subLatitude/subLongitude/altitude/groundTrackWidthDeg/groundTrackLonHalfDeg
/// and every nested sensor altitude would arrive as bare numbers at runtime
/// while the TYPE still says <c>Value&lt;"deg"&gt;</c>/<c>Value&lt;"m"&gt;</c>.
/// </para>
/// </summary>
public static class ScansatRtConfig
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
            typeof(ScanningVesselEntry),
            typeof(ScanSensorEntry),
            typeof(ScanTrackColor),
            typeof(ScanScienceEntry),
            typeof(ScanAnomalyEntry),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        // Same call core's own Configure makes, just against THIS assembly's
        // types and pointed at the npm package this Uplink's generated file
        // actually imports from (a relative "../value" path, core's default,
        // would not resolve from
        // mod/GonogoScansatUplink/client/src/__generated__/).
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        // ScanningVesselEntry and ScanScienceEntry both carry [SitrepTopic]:
        // there ARE topics to name here, unlike a command-arg-only slice.
        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_SCANSAT_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(ScansatRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_SCANSAT_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_SCANSAT_UNITJSON_OUT"),
                typeof(ScansatRtConfig).Assembly);
        }
    }
}
#endif
