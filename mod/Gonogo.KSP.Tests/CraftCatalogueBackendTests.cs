using Gonogo.KSP;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// <see cref="CraftCatalogueBackend.Load"/> and <see cref="CraftCatalogueBackend.Release"/>,
    /// exercised against the real backend rather than a fake.
    ///
    /// <para>Only the refusal branches and the release's null-safety are reachable
    /// headlessly: a real load needs a running game's save folder and a craft file
    /// on disk, neither of which exists in this process. <c>HighLogic.SaveFolder</c>
    /// is a plain static string, unset here exactly as it is before any game loads,
    /// so the "no game is loaded" branch is a real assertion about the backend's
    /// own guard rather than a fixture standing in for one.</para>
    /// </summary>
    public class CraftCatalogueBackendTests
    {
        [Fact]
        public void Load_RefusesWithNoFileNamed()
        {
            var backend = new CraftCatalogueBackend();

            var result = backend.Load(null, KspEditorFacility.VAB);

            Assert.Null(result.Ship);
            Assert.Equal("no craft file was named", result.Failure);
        }

        [Fact]
        public void Load_RefusesWithEmptyFileNamed()
        {
            var backend = new CraftCatalogueBackend();

            var result = backend.Load(string.Empty, KspEditorFacility.VAB);

            Assert.Null(result.Ship);
            Assert.Equal("no craft file was named", result.Failure);
        }

        [Fact]
        public void Load_RefusesWithNoFacilityNamed()
        {
            var backend = new CraftCatalogueBackend();

            var result = backend.Load("Ship", null);

            Assert.Null(result.Ship);
            Assert.Contains("no editor was named", result.Failure);
        }

        [Fact]
        public void Load_RefusesWithFacilityNone()
        {
            var backend = new CraftCatalogueBackend();

            var result = backend.Load("Ship", KspEditorFacility.None);

            Assert.Null(result.Ship);
            Assert.Contains("no editor was named", result.Failure);
        }

        /// <summary>
        /// <c>HighLogic.SaveFolder</c> is never set in this headless process, the
        /// same state it is in before any game has loaded, so this exercises the
        /// backend's real "no game loaded" guard rather than a stand-in for it.
        /// </summary>
        [Fact]
        public void Load_RefusesWithNoGameLoaded()
        {
            var backend = new CraftCatalogueBackend();

            var result = backend.Load("Ship", KspEditorFacility.VAB);

            Assert.Null(result.Ship);
            Assert.Contains("no game is loaded", result.Failure);
        }

        [Fact]
        public void Release_WithNullIsANoOp()
        {
            var backend = new CraftCatalogueBackend();

            backend.Release(null);
        }

        /// <summary>
        /// Anything that is not a ship this class handed out is ignored rather
        /// than thrown over, per <see cref="ICraftCatalogue.Release"/>'s own
        /// contract.
        /// </summary>
        [Fact]
        public void Release_WithAForeignObjectIsANoOp()
        {
            var backend = new CraftCatalogueBackend();

            backend.Release(new object());
        }
    }
}
