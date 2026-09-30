using System.IO;
using Xunit;

namespace Sitrep.LoadProbe.Tests
{
    public sealed class AssemblyLoadProbeTests : System.IDisposable
    {
        private readonly FixtureAssemblies _fx = new();

        public void Dispose() => _fx.Dispose();

        [Fact]
        public void A_plugin_loads_beside_the_contract_it_was_built_against()
        {
            var result = AssemblyLoadProbe.Probe(_fx.PluginPath, new[] { _fx.ContractV1Dir });

            Assert.True(result.Loaded, string.Join("\n", result.Failures));
            Assert.Empty(result.Failures);
            Assert.Equal(1, result.TypeCount);
        }

        [Fact]
        public void A_plugin_built_against_an_older_contract_fails_with_the_missing_implementation()
        {
            var result = AssemblyLoadProbe.Probe(_fx.PluginPath, new[] { _fx.ContractV2Dir });

            Assert.False(result.Loaded);
            Assert.Contains(result.Failures, f => f.Contains("TypeLoadException") && f.Contains("'Repair'") && f.Contains("does not have an implementation"));
        }

        [Fact]
        public void A_staged_contract_listed_first_shadows_the_installed_one()
        {
            var staged = AssemblyLoadProbe.Probe(_fx.PluginPath, new[] { _fx.ContractV2Dir, _fx.ContractV1Dir });
            var installed = AssemblyLoadProbe.Probe(_fx.PluginPath, new[] { _fx.ContractV1Dir, _fx.ContractV2Dir });

            Assert.False(staged.Loaded);
            Assert.True(installed.Loaded, string.Join("\n", installed.Failures));
        }

        [Fact]
        public void Directories_are_searched_recursively_like_GameData()
        {
            var gameData = Directory.GetParent(_fx.ContractV1Dir)!.Parent!.FullName;

            var result = AssemblyLoadProbe.Probe(_fx.PluginPath, new[] { Path.Combine(gameData, "v1") });

            Assert.True(result.Loaded, string.Join("\n", result.Failures));
        }

        [Fact]
        public void A_dependency_found_nowhere_is_a_failure()
        {
            var result = AssemblyLoadProbe.Probe(_fx.PluginPath, new[] { _fx.PluginDir });

            Assert.False(result.Loaded);
            Assert.Contains(result.Failures, f => f.Contains(FixtureAssemblies.ContractName));
        }

        [Fact]
        public void A_file_that_is_not_an_assembly_is_a_failure()
        {
            var bogus = Path.Combine(_fx.Root, "NotAnAssembly.dll");
            File.WriteAllText(bogus, "not a PE image");

            var result = AssemblyLoadProbe.Probe(bogus, new[] { _fx.ContractV1Dir });

            Assert.False(result.Loaded);
            Assert.Contains(result.Failures, f => f.StartsWith("BadImageFormatException"));
        }

        [Fact]
        public void A_missing_file_is_a_failure()
        {
            var result = AssemblyLoadProbe.Probe(Path.Combine(_fx.Root, "Absent.dll"), new[] { _fx.ContractV1Dir });

            Assert.False(result.Loaded);
            Assert.Contains(result.Failures, f => f.StartsWith("FileNotFoundException"));
        }

        [Fact]
        public void Each_assembly_gets_its_own_load_context()
        {
            var results = AssemblyLoadProbe.ProbeAll(
                new[] { Path.Combine(_fx.ContractV1Dir, FixtureAssemblies.ContractName + ".dll"), _fx.PluginPath },
                new[] { _fx.ContractV2Dir });

            Assert.True(results[0].Loaded, string.Join("\n", results[0].Failures));
            Assert.False(results[1].Loaded);
        }
    }
}
