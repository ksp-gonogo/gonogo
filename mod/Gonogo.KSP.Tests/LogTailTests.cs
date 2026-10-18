using System.Linq;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class LogTailTests
    {
        [Fact]
        public void Keeps_only_the_mods_lines()
        {
            var tail = new LogTail(10);
            tail.Add("[Gonogo] Started");
            tail.Add("[Other] noise");
            tail.Add(null);
            Assert.Equal(new[] { "[Gonogo] Started" }, tail.Recent(10));
        }

        [Fact]
        public void Drops_the_oldest_when_full_and_returns_oldest_first()
        {
            var tail = new LogTail(3);
            for (var i = 0; i < 5; i++) tail.Add("[Gonogo] line " + i);
            Assert.Equal(new[] { "[Gonogo] line 2", "[Gonogo] line 3", "[Gonogo] line 4" }, tail.Recent(10));
            Assert.Equal(new[] { "[Gonogo] line 3", "[Gonogo] line 4" }, tail.Recent(2));
            Assert.Empty(tail.Recent(0));
        }

        [Theory]
        [InlineData("[Gonogo] peer left")]
        [InlineData("[Gonogo] host went away")]
        [InlineData("[Gonogo] code path taken")]
        public void A_lower_case_word_after_a_keyword_is_not_a_share_code(string line)
        {
            Assert.Equal(line, LogTail.Redact(line));
        }

        [Fact]
        public void An_upper_case_share_code_is_still_redacted()
        {
            Assert.Equal("[Gonogo] hosting as host <code>", LogTail.Redact("[Gonogo] hosting as host XK3F"));
        }

        [Theory]
        [InlineData("[Gonogo] loaded /" + "Users/jon/Games/KSP/GameData/Gonogo/a.dll", "/Users")]
        [InlineData("[Gonogo] read C:\\Program Files\\KSP\\KSP.log", "C:\\")]
        [InlineData("[Gonogo] listening on 192." + "168.1.20:8090", "192.168")]
        [InlineData("[Gonogo] hosting as host XK3F", "XK3F")]
        [InlineData("[Gonogo] peer station-abc123-def456 joined", "abc123")]
        public void Removes_what_identifies_a_player_or_machine(string line, string leaked)
        {
            var tail = new LogTail(5);
            tail.Add(line);
            Assert.DoesNotContain(leaked, tail.Recent(1).Single());
        }

        [Fact]
        public void Leaves_an_ordinary_line_alone()
        {
            Assert.Equal("[Gonogo] Started - serving 12 channels", LogTail.Redact("[Gonogo] Started - serving 12 channels"));
        }
    }
}
