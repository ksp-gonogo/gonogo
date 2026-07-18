// GonogoKosUplink — GPLv3. See GonogoKosUplink.csproj's header comment for the
// licence/linkage rationale.

using System.Collections.Generic;

namespace Gonogo.KosUplink
{
    /// <summary>
    /// Builds the <c>kos.run.&lt;coreId&gt;</c> wire shape — one
    /// <see cref="Sitrep.Contract.KosRunResult"/>-shaped dictionary per
    /// completed <c>kos.run</c> dispatch.
    ///
    /// <para>Mirrors <c>KosProcessorInfoBuilder</c>'s same self-flattening
    /// producer pattern: the contract POCO is the TYPING mirror;
    /// <c>JsonWriter</c> walks this dictionary directly — no hand-written
    /// <c>AppendKosRunResult</c> case needed any more. <paramref name="fields"/>
    /// is itself a <c>Dictionary&lt;string, object?&gt;</c> and reaches
    /// JsonWriter's generic <c>IDictionary&lt;string, object?&gt;</c> case
    /// unchanged — no separate flatten needed for the field map.</para>
    /// </summary>
    public static class KosRunResultBuilder
    {
        /// <summary>
        /// Exactly one of <paramref name="fields"/>/<paramref name="error"/>
        /// is non-null (R7 typed-absence — see
        /// <see cref="Sitrep.Contract.KosRunResult"/>'s own doc comment); both
        /// are written as JSON <c>null</c> when absent, never omitted or
        /// defaulted to an empty object/string.
        /// </summary>
        public static Dictionary<string, object?> Build(
            int coreId, string requestId, Dictionary<string, object?>? fields, string? error) =>
            new Dictionary<string, object?>
            {
                ["coreId"] = coreId,
                ["requestId"] = requestId ?? "",
                ["fields"] = fields,
                ["error"] = error,
            };
    }
}
