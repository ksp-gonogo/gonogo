using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// That no GameEvents subscription names a static method.
    ///
    /// <para><c>EventData&lt;T&gt;.Add</c> reads <c>evt.Target.GetType()</c>, and a delegate
    /// over a static method has a null <c>Target</c>, so the subscription throws a
    /// NullReferenceException. Inside an Uplink's <c>Register</c> that marks the whole Uplink
    /// unavailable.</para>
    ///
    /// <para>Source text, not behaviour: the KSP assemblies cannot run in this project.</para>
    /// </summary>
    public class GameEventHandlersHaveATargetTests
    {
        private static readonly Regex Subscription = new Regex(@"GameEvents\.\w+\.Add\((\w+)\)", RegexOptions.Compiled);

        [Fact]
        public void a_subscribed_handler_is_an_instance_method()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "mod", "Gonogo.KSP")))
            {
                dir = dir.Parent;
            }
            Assert.NotNull(dir);

            var offenders = Directory
                .EnumerateFiles(Path.Combine(dir!.FullName, "mod", "Gonogo.KSP"), "*.cs", SearchOption.AllDirectories)
                .SelectMany(file =>
                {
                    var source = File.ReadAllText(file);
                    return Subscription.Matches(source)
                        .Select(m => m.Groups[1].Value)
                        .Distinct()
                        .Where(name => Regex.IsMatch(source, @"\bstatic\s+[\w<>\.,\s]+?\s" + Regex.Escape(name) + @"\("))
                        .Select(name => Path.GetFileName(file) + ": " + name);
                })
                .ToList();

            Assert.Empty(offenders);
        }
    }
}
