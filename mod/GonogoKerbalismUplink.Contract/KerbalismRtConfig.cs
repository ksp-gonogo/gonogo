#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace GonogoKerbalismUplink;

/// <summary>
/// This Uplink's OWN codegen configuration: mirrors
/// <c>Sitrep.Contract.RtConfig.Configure</c>'s shape exactly, scoped to just
/// this assembly's wire types, and reuses
/// <c>RtConfig.ApplyUnitValueTypes</c> the same way every Uplink's own
/// <c>Configure</c> does. Deliberately names no sibling Uplink: doing so would
/// trip THAT Uplink's own frontend uplink-boundary token.
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
/// <para><b>Deeply nested, and the unit map is only half of what codegen has to
/// emit for it.</b>
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
/// (<c>Vec3Of&lt;"1"&gt;</c>).</para>
///
/// <para>Of these, only <see cref="KerbalismSubjectFlagArgs"/> and
/// <see cref="KerbalismSubjectActionArgs"/> end in <c>"Args"</c>, so
/// <c>ApplyUnitValueTypes</c> skips retyping their properties (inbound only,
/// client -&gt; mod, see those types' own header comment) and retypes the
/// quantity properties on every other type here. See
/// <c>generated-value-import.test.ts</c> in this Uplink's client package,
/// which asserts the emitted import non-vacuously against the outbound
/// majority.</para>
///
/// <para><b>The only name-keyed unit maps in the whole contract live here.</b>
/// <see cref="KerbalismLifeSupport.Rates"/>,
/// <see cref="KerbalismLifeSupport.RuleEnvModifiers"/> and
/// <see cref="KerbalismProcessDef.Inputs"/>/<see cref="KerbalismProcessDef.Outputs"/>
/// are <c>Dictionary&lt;string, double&gt;</c> with a declared unit, which
/// codegen emits as <c>{ [key: string]: Value&lt;"units/s"&gt; }</c>: the unit
/// belongs to each VALUE and the key is a resource/rule NAME, so nothing
/// camel-cases it. These four are the only live examples of the form: the core
/// SDK's own generated output contains none, so its mechanism test runs off a
/// registered synthetic Topic to stay mod-agnostic and non-vacuous, and the
/// real assertions about these fields live in this Uplink's client tests.</para>
///
/// <para>Invoked by <c>mod/codegen.sh</c>'s per-uplink codegen step, writing
/// into <c>mod/GonogoKerbalismUplink/client/src/__generated__/</c>, never into
/// <c>sitrep-sdk</c>.</para>
///
/// <para><b>Runtime hydration, not just codegen.</b> These Topics' declared
/// units also have to reach <c>wrapTopicPayload</c>'s runtime lookup
/// (<c>sitrep-sdk</c>'s <c>unitsForTopic</c>/<c>shapesForTopic</c>), and the
/// SDK's own generated map has nothing for a type declared outside
/// <c>Sitrep.Contract</c>. So this Uplink's client package (<c>topics.ts</c>)
/// calls the SDK's <c>registerTopicUnits</c> AND <c>registerTypeUnits</c> at
/// module load, feeding them the unit and shape maps this Configure emits
/// below. Both legs are needed: <c>ApplyUnitValueTypes</c> fixes the
/// codegen-time TYPE, never the decode-time VALUE.</para>
/// </summary>
public static class KerbalismRtConfig
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
            // The Kerbalism namespace of reliability.summary's provider extension
            // bag. No [SitrepTopic]: it is not a Topic of this Domain's own, it is
            // a sub-tree of a CORE, Kernel-elected payload, reached through
            // extensions["kerbalism"]. It rides this codegen leg for the same
            // reason everything else here does: the type belongs to whoever fills
            // it, and core must never learn its shape.
            typeof(KerbalismReliabilityExt),
            // The Kerbalism namespaces of the four elected science.* payloads'
            // extension bags. Same reasoning as KerbalismReliabilityExt above, at a
            // larger scale: Kerbalism WINS the science election, and most of what it
            // knows (drive capacity, file-vs-sample, the requirement gate's reason,
            // the per-subject ledger) has no stock field to borrow.
            typeof(KerbalismScienceExperimentExt),
            typeof(KerbalismScienceInstrumentExt),
            typeof(KerbalismScienceLabExt),
            typeof(KerbalismScienceBreakdownExt),
            // The Kerbalism namespaces of the two elected isru.* payloads' extension
            // bags. Same boundary again, at the smallest scale yet: most of what
            // Kerbalism's ISRU knows DOES have a stock counterpart, so the core shape
            // carries it and only the genuinely Kerbalism-only parts land here (the
            // blocking-reason string, the asteroid depletion state, the process
            // throttle).
            typeof(KerbalismIsruDrillExtension),
            typeof(KerbalismIsruConverterExtension),
            // Args for the File Manager command surface (kerbalism.file.*/
            // kerbalism.sample.*): inbound only, client -> mod, so
            // ApplyUnitValueTypes below skips retyping their properties (its
            // own doc comment: any type name ending "Args" is a wire-WRITE,
            // never wrapped in a Value<>). Registered here purely so AutoI(false)
            // strips the default "I" prefix, the same reason every sibling in
            // this array is listed.
            typeof(KerbalismSubjectFlagArgs),
            typeof(KerbalismSubjectActionArgs),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        // This slice's own enums, the same numeric `export enum` shape core's
        // RtConfig uses for Quality/Staleness. The FIRST enum an Uplink slice
        // has owned: `[TsEnum]` alone does not export it, the type has to be
        // named to a builder call, exactly as an interface does.
        builder.ExportAsEnums(new[] { typeof(KerbalismStormTargetKind) });

        // Same call core's own Configure makes, just against THIS assembly's
        // types and pointed at the npm package this Uplink's generated file
        // actually imports from (a relative "../value" path, core's default,
        // would not resolve from
        // mod/GonogoKerbalismUplink/client/src/__generated__/).
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        // Five of these carry [SitrepTopic]: there ARE topics to name here,
        // unlike a command-arg-only slice.
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
