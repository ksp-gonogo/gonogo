using System.Collections.Generic;
using Gonogo.KosUplink;
using Xunit;

namespace GonogoKosUplink.Tests
{
    /// <summary>
    /// The <c>kos.run.&lt;coreId&gt;</c> wire mapping. R7 typed-absence:
    /// exactly one of <c>fields</c>/<c>error</c> is non-null on any real
    /// result — the Builder doesn't enforce that itself (the caller,
    /// <c>KosRunManager.Complete</c>, already guarantees it), so these tests
    /// just pin that both directions travel as JSON <c>null</c> when absent.
    /// </summary>
    public class KosRunResultBuilderTests
    {
        [Fact]
        public void SuccessResult_CarriesFieldsWithNullError()
        {
            var fields = new Dictionary<string, object?> { ["v"] = 1.0 };
            var entry = KosRunResultBuilder.Build(coreId: 7, requestId: "req-1", fields: fields, error: null);

            Assert.Equal(7, entry["coreId"]);
            Assert.Equal("req-1", entry["requestId"]);
            Assert.Same(fields, entry["fields"]);
            Assert.Null(entry["error"]);
        }

        [Fact]
        public void ErrorResult_CarriesErrorWithNullFields()
        {
            var entry = KosRunResultBuilder.Build(7, "req-1", fields: null, error: "engine flameout");

            Assert.Null(entry["fields"]);
            Assert.Equal("engine flameout", entry["error"]);
        }

        [Fact]
        public void EmitsExactlyTheContractsFieldSet()
        {
            var entry = KosRunResultBuilder.Build(7, "req-1", null, "x");

            var expected = new[] { "coreId", "requestId", "fields", "error" };
            Assert.Equal(expected.Length, entry.Count);
            foreach (var key in expected)
            {
                Assert.True(entry.ContainsKey(key), $"missing wire key: {key}");
            }
        }
    }
}
