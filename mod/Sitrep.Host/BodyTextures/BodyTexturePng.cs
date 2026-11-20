using System;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace Sitrep.Host.BodyTextures
{
    /// <summary>
    /// Turns a body's map, as read back from the game, into the PNG the app
    /// draws: an 8-bit RGB equirectangular map with north at the top and east to
    /// the right. Thread-safe and free of any game type, so it runs on a worker.
    /// </summary>
    public static class BodyTexturePng
    {
        private const int BytesIn = 4;
        private const int BytesOut = 3;

        private static readonly byte[] Signature = { 0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A };

        private static readonly uint[] CrcTable = BuildCrcTable();

        /// <summary>
        /// Encodes <paramref name="rgba"/>, <paramref name="width"/> by
        /// <paramref name="height"/> RGBA32 pixels with the bottom row first, as
        /// the game reads a texture back. Alpha is dropped.
        ///
        /// <para>The game's scaled-space map is the mirror image of an
        /// equirectangular map with east to the right, so each row is reversed
        /// as well as the row order: the result is the input turned through 180
        /// degrees.</para>
        /// </summary>
        public static byte[] EncodeFromGame(byte[] rgba, int width, int height)
        {
            if (rgba == null) throw new ArgumentNullException(nameof(rgba));
            if (width <= 0 || height <= 0) throw new ArgumentOutOfRangeException(nameof(width), "a map has at least one pixel");
            if (rgba.Length < (long)width * height * BytesIn)
            {
                throw new ArgumentException("the pixels are fewer than " + width + " by " + height, nameof(rgba));
            }

            using var png = new MemoryStream();
            png.Write(Signature, 0, Signature.Length);
            WriteChunk(png, "IHDR", Header(width, height));
            WriteChunk(png, "IDAT", Compress(rgba, width, height));
            WriteChunk(png, "IEND", Array.Empty<byte>());
            return png.ToArray();
        }

        private static byte[] Header(int width, int height)
        {
            var h = new byte[13];
            WriteBigEndian(h, 0, (uint)width);
            WriteBigEndian(h, 4, (uint)height);
            h[8] = 8; // bits per channel
            h[9] = 2; // truecolour, RGB
            return h;
        }

        /*
         * PNG wants a zlib stream: a two-byte header, raw deflate, then the
         * Adler-32 of the uncompressed bytes. DeflateStream writes only the
         * middle part.
         */
        private static byte[] Compress(byte[] rgba, int width, int height)
        {
            var stride = width * BytesOut;
            var previous = new byte[stride];
            var current = new byte[stride];
            var candidate = new byte[stride + 1];
            var best = new byte[stride + 1];
            uint adlerA = 1, adlerB = 0;

            using var zlib = new MemoryStream();
            zlib.WriteByte(0x78);
            zlib.WriteByte(0xDA);
            using (var deflate = new DeflateStream(zlib, CompressionLevel.Optimal, true))
            {
                for (var y = 0; y < height; y++)
                {
                    var sourceRow = height - 1 - y;
                    var rowStart = sourceRow * width * BytesIn;
                    for (var x = 0; x < width; x++)
                    {
                        var s = rowStart + (width - 1 - x) * BytesIn;
                        var d = x * BytesOut;
                        current[d] = rgba[s];
                        current[d + 1] = rgba[s + 1];
                        current[d + 2] = rgba[s + 2];
                    }

                    var bestScore = long.MaxValue;
                    for (byte filter = 0; filter <= 4; filter++)
                    {
                        var score = Filter(filter, current, previous, candidate);
                        if (score < bestScore)
                        {
                            bestScore = score;
                            Buffer.BlockCopy(candidate, 0, best, 0, candidate.Length);
                        }
                    }

                    deflate.Write(best, 0, best.Length);
                    Adler(best, ref adlerA, ref adlerB);
                    var swap = previous;
                    previous = current;
                    current = swap;
                }
            }

            var adler = (adlerB << 16) | adlerA;
            var tail = new byte[4];
            WriteBigEndian(tail, 0, adler);
            zlib.Write(tail, 0, 4);
            return zlib.ToArray();
        }

        /* Filters one row with the given PNG filter type into `into` (type byte first) and scores it by the sum of absolute signed bytes, the usual heuristic for picking one. */
        private static long Filter(byte type, byte[] row, byte[] above, byte[] into)
        {
            into[0] = type;
            long score = 0;
            for (var i = 0; i < row.Length; i++)
            {
                int a = i >= BytesOut ? row[i - BytesOut] : 0;
                int b = above[i];
                int c = i >= BytesOut ? above[i - BytesOut] : 0;
                int predicted = type switch
                {
                    0 => 0,
                    1 => a,
                    2 => b,
                    3 => (a + b) >> 1,
                    _ => Paeth(a, b, c),
                };
                var value = (byte)(row[i] - predicted);
                into[i + 1] = value;
                score += value < 128 ? value : 256 - value;
            }
            return score;
        }

        private static int Paeth(int a, int b, int c)
        {
            var p = a + b - c;
            var pa = Math.Abs(p - a);
            var pb = Math.Abs(p - b);
            var pc = Math.Abs(p - c);
            if (pa <= pb && pa <= pc) return a;
            return pb <= pc ? b : c;
        }

        private static void Adler(byte[] bytes, ref uint a, ref uint b)
        {
            const uint Mod = 65521;
            var i = 0;
            while (i < bytes.Length)
            {
                /* 5552 bytes is the most that can be summed before b can overflow 32 bits. */
                var end = Math.Min(bytes.Length, i + 5552);
                for (; i < end; i++)
                {
                    a += bytes[i];
                    b += a;
                }
                a %= Mod;
                b %= Mod;
            }
        }

        private static void WriteChunk(Stream png, string type, byte[] data)
        {
            var length = new byte[4];
            WriteBigEndian(length, 0, (uint)data.Length);
            png.Write(length, 0, 4);
            var typeBytes = Encoding.ASCII.GetBytes(type);
            png.Write(typeBytes, 0, 4);
            png.Write(data, 0, data.Length);
            var crc = Crc(0xFFFFFFFFu, typeBytes);
            crc = Crc(crc, data) ^ 0xFFFFFFFFu;
            var crcBytes = new byte[4];
            WriteBigEndian(crcBytes, 0, crc);
            png.Write(crcBytes, 0, 4);
        }

        private static uint Crc(uint crc, byte[] bytes)
        {
            foreach (var b in bytes)
            {
                crc = CrcTable[(crc ^ b) & 0xFF] ^ (crc >> 8);
            }
            return crc;
        }

        private static uint[] BuildCrcTable()
        {
            var table = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                var c = n;
                for (var k = 0; k < 8; k++)
                {
                    c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                }
                table[n] = c;
            }
            return table;
        }

        private static void WriteBigEndian(byte[] into, int at, uint value)
        {
            into[at] = (byte)(value >> 24);
            into[at + 1] = (byte)(value >> 16);
            into[at + 2] = (byte)(value >> 8);
            into[at + 3] = (byte)value;
        }
    }
}
