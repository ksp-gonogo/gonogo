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
        internal static string Read(string fileName) =>
            ReadRelative(Path.Combine("CurrencyDelay", fileName));

        /// <summary>
        /// The whole of one file under <c>mod/Gonogo.KSP/</c>, for the parts of this
        /// subsystem that do not live in its own folder: the capability declaration
        /// and the kernel binding sit on <c>CurrencyEventUplink</c>, because that is
        /// the half of the subsystem holding an <c>IUplinkHost</c>.
        /// </summary>
        internal static string ReadRelative(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "Gonogo.KSP", relativePath);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "Could not locate mod/Gonogo.KSP/" + relativePath + " from " + AppContext.BaseDirectory);
        }

        /// <summary>
        /// The brace-matched body of the method whose declaration starts with
        /// <paramref name="declaration"/>. Throws rather than asserting, so a
        /// declaration that was renamed out from under a check fails as the
        /// broken instrument it is rather than as a finding about the code.
        /// </summary>
        /// <summary>
        /// The <c>=&gt;</c> that opens an expression-bodied member, or -1. It must
        /// come after the parameter list closes, so a lambda passed as a default
        /// argument is not mistaken for the body.
        /// </summary>
        private static int ExpressionBodyArrow(string source, int declarationAt)
        {
            var paren = source.IndexOf('(', declarationAt);
            if (paren < 0)
            {
                return -1;
            }
            var depth = 0;
            for (var i = paren; i < source.Length; i++)
            {
                if (source[i] == '(')
                {
                    depth++;
                    continue;
                }
                if (source[i] == ')' && --depth == 0)
                {
                    var rest = i + 1;
                    while (rest < source.Length && char.IsWhiteSpace(source[rest]))
                    {
                        rest++;
                    }
                    return rest + 1 < source.Length && source[rest] == '=' && source[rest + 1] == '>' ? rest : -1;
                }
            }
            return -1;
        }

        /// <summary>
        /// An expression body, from its <c>=&gt;</c> to the <c>;</c> that ends it
        /// outside every bracket, so a lambda inside it stays part of the body.
        /// </summary>
        private static string ExpressionBody(string source, int arrow, string declaration)
        {
            var depth = 0;
            for (var i = arrow; i < source.Length; i++)
            {
                var c = source[i];
                if (c == '(' || c == '{' || c == '[')
                {
                    depth++;
                    continue;
                }
                if (c == ')' || c == '}' || c == ']')
                {
                    depth--;
                    continue;
                }
                if (c == ';' && depth == 0)
                {
                    return source.Substring(arrow, i - arrow + 1);
                }
            }
            throw new InvalidOperationException("Unterminated expression body for '" + declaration + "'");
        }

        internal static string MethodBody(string source, string declaration)
        {
            var declarationAt = source.IndexOf(declaration, StringComparison.Ordinal);
            if (declarationAt < 0)
            {
                throw new InvalidOperationException("No '" + declaration + "' declaration found");
            }

            var open = source.IndexOf('{', declarationAt);
            var arrow = ExpressionBodyArrow(source, declarationAt);
            if (arrow >= 0 && (open < 0 || arrow < open))
            {
                return ExpressionBody(source, arrow, declaration);
            }
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
                    continue;
                }
                if (source[i] == '}' && --depth == 0)
                {
                    return source.Substring(open, i - open + 1);
                }
            }

            throw new InvalidOperationException("Unbalanced braces after '" + declaration + "'");
        }
    }
}
