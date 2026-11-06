using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Which converter on a part a switch request means, decided from the names
    /// the part's converters carry so a test can enter it without the game.
    /// </summary>
    internal static class ConverterPick
    {
        /// <summary>
        /// The index of the converter a request means among the names on a part,
        /// or -1 with the refusal. An empty request picks the only converter and
        /// is refused when the part carries several, because a guess would switch
        /// the wrong one.
        /// </summary>
        public static int Of(IReadOnlyList<string> namesOnPart, string? requested, out Refusal? refusal)
        {
            refusal = null;
            if (namesOnPart.Count == 0)
            {
                refusal = new Refusal(CommandErrorCode.NotFound, "the part has no converter to switch");
                return -1;
            }

            if (string.IsNullOrEmpty(requested))
            {
                if (namesOnPart.Count == 1)
                {
                    return 0;
                }

                refusal = new Refusal(CommandErrorCode.NotFound, "the part has several converters, name which one");
                return -1;
            }

            for (var i = 0; i < namesOnPart.Count; i++)
            {
                if (string.Equals(namesOnPart[i], requested, StringComparison.Ordinal))
                {
                    return i;
                }
            }

            refusal = new Refusal(CommandErrorCode.NotFound, "the part has no converter by that name");
            return -1;
        }
    }
}
