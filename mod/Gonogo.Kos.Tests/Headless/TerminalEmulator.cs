// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System.Globalization;

namespace Gonogo.Kos.Tests.Headless
{
    /// <summary>
    /// A deliberately minimal xterm/VT applier — the CLIENT side of the terminal
    /// downlink, standing in for the browser's xterm.js. It applies the exact
    /// same xterm-ready chunks the mod's <see cref="ScreenDiffMapper"/> emits
    /// (cursor-absolute <c>ESC[r;cH</c> moves, <c>ESC[2J</c> clear, plain text)
    /// onto a fixed grid, so a reconstructed screen can be compared byte-for-byte
    /// against the mod's own final screen. It only needs to understand the
    /// escape vocabulary kOS's <c>TerminalXtermMapper</c> actually produces for a
    /// plain-text screen; any other <c>ESC[...&lt;final&gt;</c> sequence is
    /// consumed and ignored rather than mis-rendered.
    /// </summary>
    internal sealed class TerminalEmulator
    {
        private const char Esc = '\u001b';

        private readonly int _rows;
        private readonly int _cols;
        private readonly char[][] _grid;
        private int _row;
        private int _col;

        public TerminalEmulator(int rows, int cols)
        {
            _rows = rows;
            _cols = cols;
            _grid = new char[rows][];
            Clear();
        }

        public void Clear()
        {
            for (var r = 0; r < _rows; r++)
            {
                _grid[r] = new char[_cols];
                for (var c = 0; c < _cols; c++)
                {
                    _grid[r][c] = ' ';
                }
            }
            _row = 0;
            _col = 0;
        }

        public void Apply(string chunk)
        {
            var i = 0;
            while (i < chunk.Length)
            {
                var ch = chunk[i];
                if (ch == Esc)
                {
                    i = ApplyEscape(chunk, i);
                    continue;
                }
                if (ch == '\r')
                {
                    _col = 0;
                    i++;
                    continue;
                }
                if (ch == '\n')
                {
                    _row = Clamp(_row + 1, _rows);
                    i++;
                    continue;
                }
                Put(ch);
                i++;
            }
        }

        private int ApplyEscape(string s, int i)
        {
            // i points at ESC. Only CSI (ESC '[') is understood; a bare/other
            // ESC is skipped so it can never be mis-rendered as text.
            if (i + 1 >= s.Length || s[i + 1] != '[')
            {
                return i + 1;
            }
            var j = i + 2;
            var paramStart = j;
            while (j < s.Length && (char.IsDigit(s[j]) || s[j] == ';'))
            {
                j++;
            }
            if (j >= s.Length)
            {
                return j; // malformed / truncated — consume the rest
            }
            var final = s[j];
            var paramText = s.Substring(paramStart, j - paramStart);
            switch (final)
            {
                case 'H':
                case 'f':
                    ApplyCursorPosition(paramText);
                    break;
                case 'J':
                    // 2 = whole screen. 0/1/absent left as best-effort no-op —
                    // kOS's plain-text repaint uses absolute moves, not partial
                    // erases, so only the whole-screen form actually appears.
                    if (paramText == "2")
                    {
                        ClearKeepingCursor();
                    }
                    break;
                case 'K':
                    ClearToEndOfLine();
                    break;
                // Any other final byte (SGR 'm', etc.) is a display attribute
                // with no effect on the reconstructed character grid.
            }
            return j + 1;
        }

        private void ApplyCursorPosition(string paramText)
        {
            var row = 1;
            var col = 1;
            if (paramText.Length > 0)
            {
                var parts = paramText.Split(';');
                if (parts.Length > 0 && int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var r))
                {
                    row = r;
                }
                if (parts.Length > 1 && int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var c))
                {
                    col = c;
                }
            }
            _row = Clamp(row - 1, _rows);
            _col = Clamp(col - 1, _cols);
        }

        private void ClearKeepingCursor()
        {
            for (var r = 0; r < _rows; r++)
            {
                for (var c = 0; c < _cols; c++)
                {
                    _grid[r][c] = ' ';
                }
            }
        }

        private void ClearToEndOfLine()
        {
            for (var c = _col; c < _cols; c++)
            {
                _grid[_row][c] = ' ';
            }
        }

        private void Put(char ch)
        {
            if (_row < 0 || _row >= _rows)
            {
                return;
            }
            if (_col >= _cols)
            {
                // Wrap like a real terminal.
                _col = 0;
                _row = Clamp(_row + 1, _rows);
                if (_row >= _rows)
                {
                    return;
                }
            }
            _grid[_row][_col] = ch;
            _col++;
        }

        private static int Clamp(int v, int max)
        {
            if (v < 0)
            {
                return 0;
            }
            return v >= max ? max - 1 : v;
        }

        /// <summary>
        /// The rendered screen as text: each row right-trimmed, trailing blank
        /// rows dropped, rows joined with <c>\n</c>. Stable enough for an exact
        /// equality assertion between two reconstructions of the same screen.
        /// </summary>
        public string Text
        {
            get
            {
                var lines = new System.Collections.Generic.List<string>();
                for (var r = 0; r < _rows; r++)
                {
                    lines.Add(new string(_grid[r]).TrimEnd());
                }
                while (lines.Count > 0 && lines[lines.Count - 1].Length == 0)
                {
                    lines.RemoveAt(lines.Count - 1);
                }
                return string.Join("\n", lines);
            }
        }
    }
}
