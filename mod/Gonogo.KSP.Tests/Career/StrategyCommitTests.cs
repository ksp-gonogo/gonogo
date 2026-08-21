using Gonogo.KSP.Career;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// Committing to a strategy leaves the save exactly as it found it when the
    /// game refuses.
    ///
    /// <para><c>Strategy.Factor</c> is a plain persisted setter: it is the
    /// commitment level the player is on the hook for, and it is written to the
    /// save. The console used to set it and THEN ask, so a refused activation
    /// left the strategy's commitment changed with no activation to show for it
    /// and no way for the operator to know. Stock's Administration UI moves its
    /// slider only inside its own <c>CanBeActivated</c>-guarded flow.</para>
    ///
    /// <para>It cannot simply ask first, either: the commit-level arm of
    /// <c>CanBeActivated</c> tests <c>Factor</c>, and every up-front cost scales
    /// with it, so the gate has to see the factor the operator asked for. Write
    /// it, ask, put it back if the answer was no.</para>
    /// </summary>
    public class StrategyCommitTests
    {
        [Fact]
        public void AnAcceptedCommitmentActivatesAtTheFactorThatWasAskedFor()
        {
            var strategy = new FakeStrategy { HasFactorSlider = true, InitialFactor = 0.1f, Acceptable = true };

            var result = StrategyCommit.Activate(strategy, 0.75);

            Assert.True(result.Success);
            Assert.True(strategy.Activated);
            Assert.Equal(0.75f, strategy.Factor, 4);
        }

        /// <summary>The bug: a refusal used to keep the new commitment level.</summary>
        [Fact]
        public void ARefusedCommitmentPutsTheFactorBack()
        {
            var strategy = new FakeStrategy
            {
                HasFactorSlider = true,
                InitialFactor = 0.1f,
                Acceptable = false,
                Reason = "Maximum commitment for this Administration level is 50%",
            };

            var result = StrategyCommit.Activate(strategy, 0.9);

            Assert.False(result.Success);
            Assert.False(strategy.Activated);
            Assert.Equal(0.1f, strategy.Factor, 4);
        }

        /// <summary>
        /// The gate has to see the factor the operator asked for, or it answers
        /// about a commitment nobody requested.
        /// </summary>
        [Fact]
        public void TheGateIsAskedWithTheRequestedFactorInPlace()
        {
            var strategy = new FakeStrategy
            {
                HasFactorSlider = true, InitialFactor = 0.1f, Acceptable = false,
            };

            StrategyCommit.Activate(strategy, 0.9);

            Assert.Equal(0.9f, strategy.FactorWhenAsked, 4);
        }

        /// <summary>
        /// The game writes its own refusal sentence, in the player's language.
        /// Composing one here would be a table of KSP's vocabulary that goes
        /// stale.
        /// </summary>
        [Fact]
        public void TheRefusalQuotesTheGamesOwnReason()
        {
            var strategy = new FakeStrategy
            {
                Acceptable = false,
                Reason = "Not enough Funds to set up this Strategy",
            };

            var result = StrategyCommit.Activate(strategy, 0.0);

            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            Assert.Equal("Not enough Funds to set up this Strategy", result.Detail);
        }

        [Fact]
        public void AStrategyWithNoSliderIsNeverGivenAFactor()
        {
            var strategy = new FakeStrategy { HasFactorSlider = false, InitialFactor = 0.42f, Acceptable = true };

            StrategyCommit.Activate(strategy, 0.9);

            Assert.Equal(0.42f, strategy.Factor, 4);
            Assert.Equal(0, strategy.FactorWrites);
        }

        /// <summary>
        /// No factor asked for means leave the strategy's own commitment alone,
        /// which is what the command's contract says: best-effort, and others
        /// activate at their fixed factor.
        /// </summary>
        [Fact]
        public void NoFactorAskedForLeavesTheStrategysOwn()
        {
            var strategy = new FakeStrategy { HasFactorSlider = true, InitialFactor = 0.3f, Acceptable = true };

            StrategyCommit.Activate(strategy, 0.0);

            Assert.Equal(0.3f, strategy.Factor, 4);
            Assert.Equal(0, strategy.FactorWrites);
        }

        /// <summary>
        /// <c>Factor</c> is a 0..1 fraction and the setter is plain, so an
        /// out-of-range request would be persisted verbatim.
        /// </summary>
        [Fact]
        public void AFactorAboveFullCommitmentIsClampedRatherThanPersisted()
        {
            var strategy = new FakeStrategy { HasFactorSlider = true, InitialFactor = 0.1f, Acceptable = true };

            StrategyCommit.Activate(strategy, 4.0);

            Assert.Equal(1.0f, strategy.Factor, 4);
        }

        /// <summary>
        /// An activation that passed its own gate and still returned false has
        /// changed nothing, so the commitment must not survive it either.
        /// </summary>
        [Fact]
        public void AnActivationThatFailsAfterPassingTheGateAlsoPutsTheFactorBack()
        {
            var strategy = new FakeStrategy
            {
                HasFactorSlider = true, InitialFactor = 0.2f, Acceptable = true, ActivateSucceeds = false,
            };

            var result = StrategyCommit.Activate(strategy, 0.8);

            Assert.False(result.Success);
            Assert.Equal(0.2f, strategy.Factor, 4);
        }

        private sealed class FakeStrategy : IStrategyCommitTarget
        {
            private float _factor;

            public bool HasFactorSlider { get; set; }
            public bool Acceptable { get; set; }
            public bool ActivateSucceeds { get; set; } = true;
            public string Reason { get; set; } = "";
            public bool Activated { get; private set; }
            public int FactorWrites { get; private set; }
            public float FactorWhenAsked { get; private set; }

            /// <summary>
            /// The strategy's persisted commitment before the command, set
            /// without going through <see cref="Factor"/> so
            /// <see cref="FactorWrites"/> counts only what the sequence wrote.
            /// </summary>
            public float InitialFactor { set => _factor = value; }

            public float Factor
            {
                get => _factor;
                set
                {
                    _factor = value;
                    FactorWrites++;
                }
            }

            public bool CanBeActivated(out string reason)
            {
                FactorWhenAsked = _factor;
                reason = Reason;
                return Acceptable;
            }

            public bool Activate()
            {
                Activated = ActivateSucceeds;
                return ActivateSucceeds;
            }
        }
    }
}
