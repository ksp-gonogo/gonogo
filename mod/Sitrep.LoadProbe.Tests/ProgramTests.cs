using System.IO;
using Xunit;

namespace Sitrep.LoadProbe.Tests
{
    public sealed class ProgramTests : System.IDisposable
    {
        private readonly FixtureAssemblies _fx = new();

        public void Dispose() => _fx.Dispose();

        private static (int Code, string Out, string Err) Run(params string[] args)
        {
            var stdout = new StringWriter();
            var stderr = new StringWriter();
            var code = Program.Run(args, stdout, stderr);
            return (code, stdout.ToString(), stderr.ToString());
        }

        [Fact]
        public void Every_assembly_loading_exits_zero()
        {
            var (code, stdout, _) = Run("--resolve", _fx.ContractV1Dir, _fx.PluginPath);

            Assert.Equal(0, code);
            Assert.Contains("ok    ", stdout);
            Assert.Contains("1 of 1 assemblies load", stdout);
        }

        [Fact]
        public void Any_assembly_failing_exits_one_and_names_it()
        {
            var (code, stdout, _) = Run("--resolve", _fx.ContractV2Dir, _fx.PluginPath);

            Assert.Equal(1, code);
            Assert.Contains("FAIL  " + _fx.PluginPath, stdout);
            Assert.Contains("does not have an implementation", stdout);
            Assert.Contains("1 of 1 assemblies FAIL to load", stdout);
        }

        [Fact]
        public void Naming_no_assembly_is_a_usage_error_not_a_pass()
        {
            var (code, _, stderr) = Run("--resolve", _fx.ContractV1Dir);

            Assert.Equal(2, code);
            Assert.Contains("usage", stderr);
        }

        [Fact]
        public void A_resolve_directory_that_does_not_exist_is_a_usage_error()
        {
            var (code, _, stderr) = Run("--resolve", Path.Combine(_fx.Root, "nope"), _fx.PluginPath);

            Assert.Equal(2, code);
            Assert.Contains("does not exist", stderr);
        }

        [Fact]
        public void A_trailing_resolve_flag_is_a_usage_error()
        {
            var (code, _, _) = Run(_fx.PluginPath, "--resolve");

            Assert.Equal(2, code);
        }
    }
}
