#if NETSTANDARD2_0
using System;
using Reinforced.Typings.Fluent;

namespace GonogoKerbalismUplink;

/// <summary>
/// This Uplink's OWN codegen configuration: mirrors
/// <c>Sitrep.Contract.RtConfig.Configure</c>'s shape exactly, scoped to just
/// this assembly's fifteen wire types, and reuses
/// <c>RtConfig.ApplyUnitValueTypes</c> the same way each earlier relocated
/// Uplink's own <c>Configure</c> does (the uplink-types-out-of-core plan's
/// mechanism, unchanged here; the plan doc names the four earlier steps, this
/// file does not, since naming a sibling Uplink would trip ITS own frontend
/// uplink-boundary token).
///
/// <para><b>Five Topic-tagged roots, so the topic-map leg is not optional.</b>
/// <see cref="KerbalismSpaceWeather"/>, <see cref="KerbalismProfile"/>,
/// <see cref="KerbalismLifeSupport"/>, <see cref="KerbalismCrewEntry"/>
/// (<c>isArray</c>) and <see cref="KerbalismFeatures"/> each carry
/// <c>[SitrepTopic]</c>, so <c>EmitTopicMap</c> is wired below. The remaining
/// ten types are nested-only or dictionary-valued shapes and deliberately
/// carry no <c>[SitrepTopic]</c>: they exist to give a field's element shape a
/// name. <c>kerbalism.available</c> is a BARE JSON boolean declared
/// client-side (<c>registerBarePrimitiveTopic</c> in this Uplink's
/// <c>client/src/topics.ts</c>), so it never flows through codegen at all.
/// </para>
///
/// <para><b>The deepest nesting any relocated slice has carried, and the unit
/// map is only half of what codegen has to emit for it.</b>
/// <c>EmitUnitMap</c> writes a field -&gt; unit map AND a field -&gt;
/// nested-type SHAPE map from one reflection pass, and this slice needs the
/// second half at four separate roots:
/// <see cref="KerbalismSpaceWeather"/>'s <c>Stars</c>/<c>Storms</c>,
/// <see cref="KerbalismCrewEntry"/>'s <c>Rules</c>,
/// <see cref="KerbalismLifeSupport"/>'s
/// <c>Habitat</c>/<c>Processes</c>/<c>Greenhouses</c>, and
/// <see cref="KerbalismProfile"/>'s
/// <c>Resources</c>/<c>Rules</c>/<c>Processes</c>. Without the shape half,
/// <c>wrapTopicPayload</c> stops at the array and every per-kerbal dose,
/// per-star distance and per-process capacity arrives as a bare number while
/// the generated type still says <c>Value&lt;...&gt;</c>. The runtime
/// registration in this Uplink's client MUST feed BOTH the topic-keyed and the
/// TYPE-keyed registries for that reason: see <c>client/src/topics.ts</c>.
/// </para>
///
/// <para><b>A Vec3 on a nested type, which is new.</b>
/// <see cref="KerbalismStarInfo.Direction"/> is a <c>Vec3</c> carrying
/// <c>Units.Dimensionless</c>, and <see cref="KerbalismStarInfo"/> is itself
/// reached only through <see cref="KerbalismSpaceWeather.Stars"/>. So the unit
/// declared on that one field has to survive two hops of shape resolution and
/// then propagate to the vector's three scalar leaves
/// (<c>Vec3Of&lt;"1"&gt;</c>). Earlier relocated slices used no <c>Vec3</c> at
/// all.</para>
///
/// <para>None of these fifteen types has a name ending in <c>"Args"</c>, so
/// <c>ApplyUnitValueTypes</c> retypes the quantity properties on ALL of them:
/// there is no inbound-only member of this set for it to skip, unlike the
/// command-arg slices earlier in the plan. See
/// <c>generated-value-import.test.ts</c> in this Uplink's client package,
/// which asserts the emitted import non-vacuously.</para>
///
/// <para><b>The only name-keyed unit maps in the whole contract live here.</b>
/// <see cref="KerbalismLifeSupport.Rates"/>,
/// <see cref="KerbalismLifeSupport.RuleEnvModifiers"/> and
/// <see cref="KerbalismProcessDef.Inputs"/>/<see cref="KerbalismProcessDef.Outputs"/>
/// are <c>Dictionary&lt;string, double&gt;</c> with a declared unit, which
/// codegen emits as <c>{ [key: string]: Value&lt;"units/s"&gt; }</c>: the unit
/// belongs to each VALUE and the key is a resource/rule NAME, so nothing
/// camel-cases it. That was the case that taught the SDK's wrap to handle a
/// map at all, and with this relocation the core SDK's own generated output no
/// longer contains a single example of the form. The SDK keeps its mechanism
/// test (driven off a registered synthetic Topic so it stays mod-agnostic and
/// non-vacuous); the real assertions about these four fields moved into this
/// Uplink's client tests.</para>
///
/// <para>Invoked by <c>mod/codegen.sh</c>'s per-uplink codegen step, writing
/// into <c>mod/GonogoKerbalismUplink/client/src/__generated__/</c>, never into
/// <c>sitrep-sdk</c>.</para>
///
/// <para><b>Runtime hydration, not just codegen.</b> A relocated Topic's
/// declared units also have to reach <c>wrapTopicPayload</c>'s runtime lookup
/// (<c>sitrep-sdk</c>'s <c>unitsForTopic</c>/<c>shapesForTopic</c>), which used
/// to read the five <c>kerbalism.*</c> Topics straight out of the SDK's own
/// generated map because these types lived in <c>Sitrep.Contract</c>. They do
/// not any more, so this Uplink's client package (<c>topics.ts</c>) calls the
/// SDK's <c>registerTopicUnits</c> AND <c>registerTypeUnits</c> at module load,
/// feeding them the unit and shape maps this Configure emits below (see those
/// functions' own doc comments for why: <c>ApplyUnitValueTypes</c> only fixes
/// the codegen-time TYPE, not the decode-time VALUE).</para>
/// </summary>
public static class KerbalismRtConfig
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
            // kerbalism.spaceweather + its two nested per-star/per-storm shapes
            typeof(KerbalismSpaceWeather),
            typeof(KerbalismStarInfo),
            typeof(KerbalismStormEntry),
            // kerbalism.lifesupport + its nested habitat/process/greenhouse shapes
            typeof(KerbalismLifeSupport),
            typeof(KerbalismResource),
            typeof(KerbalismHabitat),
            typeof(KerbalismProcessEntry),
            typeof(KerbalismGreenhouseEntry),
            // kerbalism.crew + its nested per-rule survival shape
            typeof(KerbalismCrewEntry),
            typeof(KerbalismCrewRule),
            // kerbalism.profile: the loaded profile's own definitions, so the
            // app derives the resource graph without gonogo naming a resource
            typeof(KerbalismProfile),
            typeof(KerbalismResourceDef),
            typeof(KerbalismRuleDef),
            typeof(KerbalismProcessDef),
            // kerbalism.features
            typeof(KerbalismFeatures),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        // Same call core's own Configure makes, just against THIS assembly's
        // types and pointed at the npm package this Uplink's generated file
        // actually imports from (a relative "../value" path, core's default,
        // would not resolve from
        // mod/GonogoKerbalismUplink/client/src/__generated__/).
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        // Five of the fifteen carry [SitrepTopic]: there ARE topics to name
        // here, unlike a command-arg-only slice.
        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_KERBALISM_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(KerbalismRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_KERBALISM_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_KERBALISM_UNITJSON_OUT"),
                typeof(KerbalismRtConfig).Assembly);
        }
    }
}
#endif
