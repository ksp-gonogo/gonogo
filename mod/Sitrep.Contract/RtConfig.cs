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

        // Non-generic types: register directly via ExportAsInterface<T>(), which shares
        // the same TypeBlueprint the [TsInterface] attribute already created for the type.
        builder.ExportAsInterface<Meta>().AutoI(false).WithPublicProperties().OverrideName("Meta");
        builder.ExportAsInterface<EventMsg>().AutoI(false).WithPublicProperties().OverrideName("EventMsg");
        builder.ExportAsInterface<ErrorMsg>().AutoI(false).WithPublicProperties().OverrideName("ErrorMsg");
        builder.ExportAsInterface<Subscribe>().AutoI(false).WithPublicProperties().OverrideName("Subscribe");
        builder.ExportAsInterface<Unsubscribe>().AutoI(false).WithPublicProperties().OverrideName("Unsubscribe");

        // Generic types: ExportAsInterface<StreamData<object>>() would target the CLOSED
        // constructed type (a distinct TypeBlueprint from the open generic definition the
        // attribute scan already registered), producing a redundant non-generic duplicate
        // with `any` in place of the type parameter. Registering the open generic type
        // definition directly via the Type-based ExportAsInterfaces overload instead
        // configures the SAME blueprint the attribute scan produced, so the emitted
        // interface keeps its `<T>` / `<TArgs>` / `<TResult>` generic parameter.
        builder.ExportAsInterfaces(
            new[] { typeof(StreamData<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("StreamData"));
        builder.ExportAsInterfaces(
            new[] { typeof(CommandRequest<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("CommandRequest"));
        builder.ExportAsInterfaces(
            new[] { typeof(CommandResponse<>) },
            c => c.AutoI(false).WithPublicProperties().OverrideName("CommandResponse"));

        builder.ExportAsEnum<Quality>();
        builder.ExportAsEnum<Staleness>();
    }
}
