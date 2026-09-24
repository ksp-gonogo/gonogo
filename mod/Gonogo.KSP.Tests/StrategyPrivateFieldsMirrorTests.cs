using System.Reflection;
using System.Runtime.CompilerServices;
using Strategies;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The two private fields the off-screen activation writes, against the
    /// installed <c>Assembly-CSharp</c>.
    ///
    /// <para>A renamed or retyped field breaks no compile, because the write is a
    /// string lookup. Without this, a KSP build that moved one would make every
    /// activation refuse as unreadable (the resolver's null) and nothing would
    /// say why; worse, a field that kept its name and changed meaning would be
    /// written with a value stock no longer reads. So each is held to its name,
    /// its type, and to being exactly what stock's own public getter
    /// reports.</para>
    /// </summary>
    public class StrategyPrivateFieldsMirrorTests
    {
        private const BindingFlags Declared =
            BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;

        [Theory]
        [InlineData("isActive", typeof(bool))]
        [InlineData("dateActivated", typeof(double))]
        public void StockStillDeclaresTheFieldPrivatelyWithThisType(string name, System.Type type)
        {
            var field = typeof(Strategy).GetField(name, Declared);

            Assert.NotNull(field);
            Assert.True(field!.IsPrivate, name + " is no longer private, so it may have a setter to call instead");
            Assert.Equal(type, field.FieldType);
        }

        [Fact]
        public void BothFieldsResolve()
        {
            Assert.Same(typeof(Strategy).GetField("isActive", Declared), StrategyPrivateFields.IsActive);
            Assert.Same(typeof(Strategy).GetField("dateActivated", Declared), StrategyPrivateFields.DateActivated);
            Assert.True(StrategyPrivateFields.Resolved);
        }

        [Fact]
        public void AFieldWhoseTypeChangedDoesNotResolve()
        {
            Assert.Null(StrategyPrivateFields.Resolve("isActive", typeof(int)));
            Assert.Null(StrategyPrivateFields.Resolve("dateActivated", typeof(float)));
        }

        [Fact]
        public void AFieldThatIsGoneDoesNotResolve()
        {
            Assert.Null(StrategyPrivateFields.Resolve("isActivated", typeof(bool)));
        }

        /// <summary>
        /// The two halves of stock's activation the patch read asks Harmony about.
        /// A half that stopped resolving would make the read Unknown for every
        /// career, and every shut-screen activation refuse as unreadable.
        /// </summary>
        [Fact]
        public void BothHalvesThePatchReadNamesResolve()
        {
            Assert.NotNull(StockActivationPatch.Activate);
            Assert.NotNull(StockActivationPatch.CanBeActivated);
            Assert.Equal(typeof(bool), ((MethodInfo)StockActivationPatch.CanBeActivated!).ReturnType);
        }

        /// <summary>
        /// The write lands where stock's own getters read. An uninitialised
        /// instance, because <c>Strategy</c>'s constructor reaches config the test
        /// process does not have and the getters touch nothing else.
        /// </summary>
        [Fact]
        public void WritingTheFieldsIsWhatTheGameReports()
        {
            var strategy = (Strategy)RuntimeHelpers.GetUninitializedObject(typeof(Strategy));

            StrategyPrivateFields.IsActive!.SetValue(strategy, true);
            StrategyPrivateFields.DateActivated!.SetValue(strategy, 123456.5);

            Assert.True(strategy.IsActive);
            Assert.Equal(123456.5, strategy.DateActivated);
        }
    }
}
