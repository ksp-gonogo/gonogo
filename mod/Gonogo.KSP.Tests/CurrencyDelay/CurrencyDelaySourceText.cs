using System;
using System.IO;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// Reads the shipped source of the currency-delay files this project cannot
    /// compile, so a test can say something about code that only a live scene can
    /// run.
    ///
    /// <para>Shared rather than copied into each wiring check: the brace matcher
    /// is the fiddly half, and two of them would drift apart exactly where it
    /// matters least and cost most.</para>
    /// </summary>
    internal static class CurrencyDelaySourceText
    {
        /// <summary>The whole of one file under <c>mod/Gonogo.KSP/CurrencyDelay/</c>.</summary>
        internal static string Read(string fileName)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "Gonogo.KSP", "CurrencyDelay", fileName);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "Could not locate mod/Gonogo.KSP/CurrencyDelay/" + fileName + " from " + AppContext.BaseDirectory);
        }

        /// <summary>
        /// The brace-matched body of the method whose declaration starts with
        /// <paramref name="declaration"/>. Throws rather than asserting, so a
        /// declaration that was renamed out from under a check fails as the
        /// broken instrument it is rather than as a finding about the code.
        /// </summary>
        internal static string MethodBody(string source, string declaration)
        {
            var declarationAt = source.IndexOf(declaration, StringComparison.Ordinal);
            if (declarationAt < 0)
            {
                throw new InvalidOperationException("No '" + declaration + "' declaration found");
            }

            var open = source.IndexOf('{', declarationAt);
            if (open < 0)
            {
                throw new InvalidOperationException("No body found for '" + declaration + "'");
            }

            var depth = 0;
            for (var i = open; i < source.Length; i++)
            {
                if (source[i] == '{')
                {
                    depth++;
                }
                else if (source[i] == '}' && --depth == 0)
                {
                    return source.Substring(open, i - open + 1);
                }
            }

            throw new InvalidOperationException("Unbalanced braces after '" + declaration + "'");
        }
    }
}
