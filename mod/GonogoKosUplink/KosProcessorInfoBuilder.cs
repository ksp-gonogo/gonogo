// GonogoKosUplink — GPLv3. See GonogoKosUplink.csproj's header comment for the
// licence/linkage rationale.

using System.Collections.Generic;

namespace Gonogo.KosUplink
{
    /// <summary>
    /// Builds the <c>kos.processors</c> wire shape — one
    /// <see cref="Sitrep.Contract.KosProcessorInfo"/>-shaped dictionary per
    /// kOS CPU.
    ///
    /// <para>Same self-flattening producer pattern already used elsewhere in
    /// this codebase: the contract POCO is the TYPING mirror (what TS codegen
    /// reflects over), and <c>JsonWriter</c> walks this dictionary to make
    /// the actual bytes — no hand-written <c>AppendKosProcessorInfo</c> case
    /// needed any more. Keys are camelCase to match the generated TS shape,
    /// so this dictionary and <see cref="Sitrep.Contract.KosProcessorInfo"/>
    /// agree field for field.</para>
    ///
    /// <para>KSP-free by construction (no kOS/Unity types touched), so it is
    /// exercised headlessly — see <c>GonogoKosUplink.Tests</c>.</para>
    /// </summary>
    public static class KosProcessorInfoBuilder
    {
        /// <summary>
        /// Nullable <paramref name="tag"/>/<paramref name="bootFilePath"/> are
        /// written as JSON <c>null</c> when absent (R7 typed-absence — see
        /// <see cref="Sitrep.Contract.KosProcessorInfo"/>'s own doc comment),
        /// never a sentinel empty string.
        /// </summary>
        public static Dictionary<string, object?> Build(
            int coreId, string? tag, bool hasBooted, string? bootFilePath, string processorMode) =>
            new Dictionary<string, object?>
            {
                ["coreId"] = coreId,
                ["tag"] = tag,
                ["hasBooted"] = hasBooted,
                ["bootFilePath"] = bootFilePath,
                ["processorMode"] = processorMode ?? "",
            };
    }
}
