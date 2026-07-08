#if NETSTANDARD2_0
using System;
using Reinforced.Typings.Fluent;

namespace Sitrep.Contract;

public static class RtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true) // ES modules: `export interface`, no `module` wrapper
            .AutoOptionalProperties()); // C# `T?` -> TS `prop?`

        // --- Envelope (non-generic) ---
        // Register directly via ExportAsInterface<T>(), which shares the same
        // TypeBlueprint the [TsInterface] attribute already created for the type.
        // AutoI(false) keeps the plain C# name (no I-prefix); WithPublicProperties
        // emits DATA SHAPES ONLY — no constructors, no static factory methods
        // (e.g. Vec3's ctors, CommandResult.Ok/Fail) leak onto the wire type.
        builder.ExportAsInterface<Meta>().AutoI(false).WithPublicProperties().OverrideName("Meta");
        builder.ExportAsInterface<EventMsg>().AutoI(false).WithPublicProperties().OverrideName("EventMsg");
        builder.ExportAsInterface<ErrorMsg>().AutoI(false).WithPublicProperties().OverrideName("ErrorMsg");
        builder.ExportAsInterface<Subscribe>().AutoI(false).WithPublicProperties().OverrideName("Subscribe");
        builder.ExportAsInterface<Unsubscribe>().AutoI(false).WithPublicProperties().OverrideName("Unsubscribe");

        // --- Envelope + command generics (open generic definitions) ---
        // ExportAsInterface<StreamData<object>>() would target the CLOSED
        // constructed type (a distinct TypeBlueprint from the open generic definition
        // the attribute scan already registered), producing a redundant non-generic
        // duplicate with `any` in place of the type parameter. Registering the open
        // generic type definition via the Type-based ExportAsInterfaces overload
        // instead configures the SAME blueprint the attribute scan produced, so the
        // emitted interface keeps its `<T>` / `<TArgs>` / `<TResult>` generic parameter.
        builder.ExportAsInterfaces(
            new[] { typeof(StreamData<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("StreamData"));
        builder.ExportAsInterfaces(
            new[] { typeof(CommandRequest<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("CommandRequest"));
        builder.ExportAsInterfaces(
            new[] { typeof(CommandResponse<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("CommandResponse"));

        // The generic result carries a distinct name (CommandResultOf<T>) from its
        // non-generic base (CommandResult). Two `export interface CommandResult`
        // declarations of differing arity would be a TS2428 error ("all declarations
        // must have identical type parameters") — TS interface-merging cannot span a
        // generic/non-generic pair. Renaming the generic sidesteps the collision while
        // keeping the base name stable; CommandResultOf<T> still `extends CommandResult`.
        builder.ExportAsInterfaces(
            new[] { typeof(CommandResult<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("CommandResultOf"));

        // --- Wire payload types (non-generic) ---
        // Everything else marked [SitrepContract]/[TsInterface] that crosses the wire:
        // vessel.* channel payloads, comms.* channels, kos.* channels, command args,
        // and the shared value shapes (Vec3, PayloadMeta, CommandResult).
        builder.ExportAsInterfaces(
            new[]
            {
                // shared value shapes
                typeof(Vec3),
                typeof(PayloadMeta),
                typeof(CommandResult),
                // vessel.* channels
                typeof(VesselAttitude),
                typeof(VesselComms),
                typeof(VesselControl),
                typeof(VesselCrew),
                typeof(VesselFlight),
                typeof(VesselIdentity),
                typeof(VesselManeuver),
                typeof(VesselOrbit),
                typeof(VesselOrbitTruth),
                typeof(VesselPropulsion),
                typeof(VesselResources),
                typeof(VesselStructure),
                typeof(VesselSurface),
                typeof(VesselTarget),
                typeof(VesselThermal),
                // nested payload records
                typeof(OrbitEncounter),
                typeof(ManeuverNode),
                typeof(DockAlignment),
                typeof(ResourceAmount),
                typeof(ThermalHottestPart),
                typeof(WarpState),
                // comms.* channels
                typeof(CommsConnectivity),
                typeof(CommsSignalStrength),
                typeof(CommsControlState),
                typeof(CommsPath),
                typeof(CommsHop),
                typeof(CommsNetwork),
                typeof(CommsNetworkNode),
                typeof(CommsNetworkEdge),
                typeof(CommsDelay),
                typeof(CommsLinkQuality),
                typeof(CommsDataRate),
                typeof(CommsLinkMargin),
                // kos.* channels
                typeof(KosProcessorInfo),
                typeof(KosComputeStatus),
                typeof(KosExecArgs),
                typeof(KosReEnableArgs),
                // command args
                typeof(AddManeuverNodeArgs),
                typeof(UpdateManeuverNodeArgs),
                typeof(RemoveManeuverNodeArgs),
                typeof(SetActionGroupArgs),
                typeof(SetEnabledArgs),
                typeof(SetPausedArgs),
                typeof(SetSasModeArgs),
                typeof(SetTargetArgs),
                typeof(SetThrottleArgs),
                typeof(SetWarpIndexArgs),
            },
            c => c.AutoI(false).WithPublicProperties());

        // --- Enums (numeric `export enum`, per the existing Quality/Staleness convention) ---
        builder.ExportAsEnums(
            new[]
            {
                typeof(Quality),
                typeof(Staleness),
                typeof(CommandErrorCode),
                typeof(CommsControlSource),
                typeof(CommsControlStateKind),
                typeof(CommsDelaySource),
                typeof(CommsHopKind),
                typeof(ControlState),
                typeof(SasMode),
                typeof(Situation),
                typeof(TargetKind),
                typeof(TransitionType),
                typeof(VesselType),
                typeof(WarpMode),
            });
    }
}
#endif
