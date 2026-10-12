using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The saved-ship list is read off disk and cached. It must come back for a different
    /// save at once, and must refresh in the editor, where the game clock stands still.
    /// </summary>
    public class RescanGateTests
    {
        [Fact]
        public void the_first_read_is_due()
        {
            Assert.True(new RescanGate(10).Due("a", 100, 0));
        }

        [Fact]
        public void a_read_inside_the_interval_is_served_from_the_cache()
        {
            var gate = new RescanGate(10);
            gate.Scanned("a", 100, 0);

            Assert.False(gate.Due("a", 5000, 9.9));
        }

        [Fact]
        public void another_save_is_read_at_once()
        {
            var gate = new RescanGate(10);
            gate.Scanned("career-a", 100, 0);

            Assert.True(gate.Due("career-b", 100, 0.1));
        }

        [Fact]
        public void the_editor_refreshes_with_the_game_clock_stopped()
        {
            var gate = new RescanGate(10);
            gate.Scanned("a", 100, 0);

            Assert.True(gate.Due("a", 100, 10));
        }

        [Fact]
        public void a_clock_gone_back_is_read_at_once()
        {
            var gate = new RescanGate(10);
            gate.Scanned("a", 100, 0);

            Assert.True(gate.Due("a", 50, 0.1));
        }

        [Fact]
        public void a_forgotten_read_is_due()
        {
            var gate = new RescanGate(10);
            gate.Scanned("a", 100, 0);
            gate.Forget();

            Assert.True(gate.Due("a", 100, 0.1));
        }
    }
}
