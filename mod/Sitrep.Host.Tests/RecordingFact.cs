using System;
using System.IO;
using System.Runtime.CompilerServices;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A <see cref="FactAttribute"/> for a test whose input is one of the real
    /// KSP captures under <c>local_docs/telemetry-mod/recordings/</c>. Those are
    /// gitignored local-only assets, so they are absent in CI and on any machine
    /// that has not captured one, and the test cannot run.
    ///
    /// <para>It resolves the recording at DISCOVERY time and sets
    /// <see cref="FactAttribute.Skip"/> when the file is not there, so the test
    /// is reported as SKIPPED with the reason attached. The idiom it replaces
    /// was an <c>if (!File.Exists) { _output.WriteLine("SKIPPING: ..."); return; }</c>
    /// at the top of each body, which reports a PASS: thirteen tests across four
    /// files claimed to validate a 7.5 MB capture end to end and asserted nothing
    /// at all, in CI, always. A green that is indistinguishable from a green that
    /// ran is the failure mode; xunit already has a state for "did not run" and
    /// this uses it.</para>
    ///
    /// <para>Linked into <c>Sitrep.Host.IntegrationTests</c> by that project's
    /// csproj (the same selective-<c>Compile</c> pattern it already uses for the
    /// production wire builders), so both suites skip on the same terms rather
    /// than each carrying a copy.</para>
    /// </summary>
    [AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
    public sealed class RecordingFactAttribute : FactAttribute
    {
        /// <param name="recordingFileName">
        /// File name inside <c>local_docs/telemetry-mod/recordings/</c>, e.g.
        /// <c>reference-session-2026-07-07.json</c>.
        /// </param>
        public RecordingFactAttribute(
            string recordingFileName,
            [CallerFilePath] string sourceFilePath = "")
        {
            RecordingFileName = recordingFileName;
            RecordingPath = ResolveRecordingPath(recordingFileName, sourceFilePath);

            if (!File.Exists(RecordingPath))
            {
                Skip =
                    $"recording \"{recordingFileName}\" is not at \"{RecordingPath}\". It is a "
                    + "gitignored local-only capture (local_docs/ per CLAUDE.md) and is never "
                    + "present in CI, so this test has no input to run against.";
            }
        }

        /// <summary>File name this test's recording is looked up under.</summary>
        public string RecordingFileName { get; }

        /// <summary>Absolute path the recording was looked for at.</summary>
        public string RecordingPath { get; }

        /// <summary>
        /// The recording directory, derived from the calling SOURCE file rather
        /// than the working directory: a test binary runs out of
        /// <c>bin/Debug/net10.0</c> and every project that uses this sits two
        /// levels below the repo root (<c>mod/&lt;Project&gt;/</c>).
        /// </summary>
        public static string ResolveRecordingPath(
            string recordingFileName,
            [CallerFilePath] string sourceFilePath = "")
        {
            var testDir = Path.GetDirectoryName(sourceFilePath)!;
            return Path.GetFullPath(
                Path.Combine(
                    testDir, "..", "..", "local_docs", "telemetry-mod", "recordings", recordingFileName));
        }
    }
}
