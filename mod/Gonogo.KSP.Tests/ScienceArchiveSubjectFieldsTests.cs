using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The R&amp;D archive is walked every sample. A subject id stock cannot parse yields
    /// empty strings, which are absence, and asking stock for an experiment that is no
    /// longer installed writes a log line each time, so each id is parsed once.
    ///
    /// <para>Source text, not behaviour: the archive walk reads live R&amp;D and cannot be
    /// compiled into this project.</para>
    /// </summary>
    public class ScienceArchiveSubjectFieldsTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Fact]
        public void the_archive_walk_reads_each_subject_through_the_cache()
        {
            var walk = CurrencyDelaySourceText.MethodBody(Source, "private static List<object?>? BuildScienceArchive()");

            Assert.Contains("ArchiveSubjectFields(subject.id)", walk, StringComparison.Ordinal);
            Assert.DoesNotContain("GetExperiment(", walk, StringComparison.Ordinal);
        }

        [Fact]
        public void a_parsed_subject_is_cached_and_an_empty_part_is_null()
        {
            var parse = CurrencyDelaySourceText.MethodBody(Source, "private static SubjectFields ArchiveSubjectFields(string subjectId)");

            Assert.Contains("ArchiveSubjectFieldsById.TryGetValue(subjectId, out var cached)", parse, StringComparison.Ordinal);
            Assert.Contains("ArchiveSubjectFieldsById[subjectId] = fields;", parse, StringComparison.Ordinal);
            Assert.Contains("string.IsNullOrEmpty(body) ? null : body", parse, StringComparison.Ordinal);
            Assert.Contains("string.IsNullOrEmpty(situation) ? null : situation", parse, StringComparison.Ordinal);
            Assert.Contains("string.IsNullOrEmpty(biome) ? null : biome", parse, StringComparison.Ordinal);
        }
    }
}
