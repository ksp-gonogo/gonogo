// GonogoKosUplink — GPLv3. See GonogoKosUplink.csproj's header comment for the
// licence/linkage rationale.

using System.Collections.Generic;

namespace Gonogo.KosUplink
{
    /// <summary>
    /// Builds the <c>kos.terminal.&lt;coreId&gt;</c> wire shape — one
    /// <see cref="Sitrep.Contract.KosTerminalFrame"/>-shaped dictionary per
    /// downlink frame.
    ///
    /// <para>Mirrors <c>KosProcessorInfoBuilder</c>'s same self-flattening
    /// producer pattern: the contract POCO is the TYPING mirror;
    /// <c>JsonWriter</c> walks this dictionary directly — no hand-written
    /// <c>AppendKosTerminalFrame</c> case needed any more. Also lets
    /// <c>ChannelDeclaration.IsKeyframe</c> (wired in <c>KosExtension.Ksp.cs</c>)
    /// key off the <c>fullRepaint</c> dictionary entry instead of the POCO
    /// type, since the dictionary is what actually reaches the Courier.</para>
    /// </summary>
    public static class KosTerminalFrameBuilder
    {
        public static Dictionary<string, object?> Build(int coreId, string chunk, bool fullRepaint) =>
            new Dictionary<string, object?>
            {
                ["coreId"] = coreId,
                ["chunk"] = chunk ?? "",
                ["fullRepaint"] = fullRepaint,
            };
    }
}
