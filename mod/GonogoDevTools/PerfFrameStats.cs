using System.Globalization;
using System.Text;

namespace Gonogo.DevTools
{
    /// <summary>
    /// Collections of each generation, the slowest frame and the slowest frame a
    /// collection landed in, over one report interval. A frame is a GC frame when
    /// any generation's count rose since the frame before, which is what ties a
    /// long frame to the collector rather than to something else.
    /// </summary>
    internal sealed class PerfFrameStats
    {
        private int _lastGen0 = -1;
        private int _lastGen1;
        private int _lastGen2;
        private int _gen0;
        private int _gen1;
        private int _gen2;
        private int _frames;
        private double _worstFrameMs;
        private double _worstGcFrameMs;
        private long _monoHeapBytes;

        /// <summary>One rendered frame: the collection counts read at its end, its length and the managed heap in use.</summary>
        public void Sample(int gen0, int gen1, int gen2, double frameMs, long monoHeapBytes)
        {
            if (_lastGen0 >= 0)
            {
                var d0 = gen0 - _lastGen0;
                var d1 = gen1 - _lastGen1;
                var d2 = gen2 - _lastGen2;
                _gen0 += d0;
                _gen1 += d1;
                _gen2 += d2;
                if ((d0 > 0 || d1 > 0 || d2 > 0) && frameMs > _worstGcFrameMs)
                {
                    _worstGcFrameMs = frameMs;
                }
            }
            _lastGen0 = gen0;
            _lastGen1 = gen1;
            _lastGen2 = gen2;
            _frames++;
            if (frameMs > _worstFrameMs)
            {
                _worstFrameMs = frameMs;
            }
            _monoHeapBytes = monoHeapBytes;
        }

        /// <summary>The <c>"gc"</c>, <c>"frames"</c> and <c>"monoHeapBytes"</c> members of a report line, then a fresh interval.</summary>
        public string TakeIntervalJson()
        {
            var json = new StringBuilder()
                .Append("\"frames\":").Append(_frames.ToString(CultureInfo.InvariantCulture))
                .Append(",\"worstFrameMs\":").Append(_worstFrameMs.ToString("0.###", CultureInfo.InvariantCulture))
                .Append(",\"worstGcFrameMs\":").Append(_worstGcFrameMs.ToString("0.###", CultureInfo.InvariantCulture))
                .Append(",\"gc\":{\"gen0\":").Append(_gen0.ToString(CultureInfo.InvariantCulture))
                .Append(",\"gen1\":").Append(_gen1.ToString(CultureInfo.InvariantCulture))
                .Append(",\"gen2\":").Append(_gen2.ToString(CultureInfo.InvariantCulture))
                .Append("},\"monoHeapBytes\":").Append(_monoHeapBytes.ToString(CultureInfo.InvariantCulture))
                .ToString();
            _gen0 = 0;
            _gen1 = 0;
            _gen2 = 0;
            _frames = 0;
            _worstFrameMs = 0;
            _worstGcFrameMs = 0;
            return json;
        }
    }
}
