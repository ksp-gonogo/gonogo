using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using Sitrep.Host.BodyTextures;
using Xunit;

namespace Sitrep.Host.Tests.BodyTextures
{
    public class BodyTexturePngTests
    {
        private static byte[] Rgba(params (byte R, byte G, byte B)[] pixels) =>
            pixels.SelectMany(p => new byte[] { p.R, p.G, p.B, 255 }).ToArray();

        [Fact]
        public void TheGamesMapIsTurnedThroughHalfATurnSoNorthIsUpAndEastIsRight()
        {
            /* Bottom row first, as the game reads it back: A B along the bottom, C D along the top. */
            var a = ((byte)10, (byte)0, (byte)0);
            var b = ((byte)20, (byte)0, (byte)0);
            var c = ((byte)30, (byte)0, (byte)0);
            var d = ((byte)40, (byte)0, (byte)0);

            var image = PngReader.Read(BodyTexturePng.EncodeFromGame(Rgba(a, b, c, d), 2, 2));

            Assert.Equal(2, image.Width);
            Assert.Equal(2, image.Height);
            Assert.Equal(new[] { d, c }, image.Row(0));
            Assert.Equal(new[] { b, a }, image.Row(1));
        }

        [Fact]
        public void EveryPixelOfAnIrregularMapSurvivesTheFiltersAndCompression()
        {
            const int width = 37;
            const int height = 11;
            var random = new Random(7);
            var rgba = new byte[width * height * 4];
            random.NextBytes(rgba);

            var image = PngReader.Read(BodyTexturePng.EncodeFromGame(rgba, width, height));

            for (var y = 0; y < height; y++)
            {
                var row = image.Row(y);
                for (var x = 0; x < width; x++)
                {
                    var s = ((height - 1 - y) * width + (width - 1 - x)) * 4;
                    Assert.Equal((rgba[s], rgba[s + 1], rgba[s + 2]), row[x]);
                }
            }
        }

        [Fact]
        public void TooFewPixelsForTheSizeIsRefused()
        {
            Assert.Throws<ArgumentException>(() => BodyTexturePng.EncodeFromGame(new byte[12], 2, 2));
        }

        /// <summary>A reader for exactly the PNGs the encoder writes, checking every chunk checksum and the zlib checksum on the way.</summary>
        internal sealed class PngReader
        {
            private readonly byte[] _pixels;

            private PngReader(int width, int height, byte[] pixels)
            {
                Width = width;
                Height = height;
                _pixels = pixels;
            }

            public int Width { get; }

            public int Height { get; }

            public (byte, byte, byte)[] Row(int y) =>
                Enumerable.Range(0, Width).Select(x =>
                {
                    var i = (y * Width + x) * 3;
                    return (_pixels[i], _pixels[i + 1], _pixels[i + 2]);
                }).ToArray();

            public static PngReader Read(byte[] png)
            {
                Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, png.Take(8).ToArray());
                var at = 8;
                int width = 0, height = 0;
                var idat = new MemoryStream();
                var sawEnd = false;
                while (at < png.Length)
                {
                    var length = (int)BigEndian(png, at);
                    var type = Encoding.ASCII.GetString(png, at + 4, 4);
                    var data = png.Skip(at + 8).Take(length).ToArray();
                    var crc = BigEndian(png, at + 8 + length);
                    Assert.Equal(Crc(png.Skip(at + 4).Take(4 + length).ToArray()), crc);
                    switch (type)
                    {
                        case "IHDR":
                            width = (int)BigEndian(data, 0);
                            height = (int)BigEndian(data, 4);
                            Assert.Equal(8, data[8]);
                            Assert.Equal(2, data[9]);
                            break;
                        case "IDAT":
                            idat.Write(data, 0, data.Length);
                            break;
                        case "IEND":
                            sawEnd = true;
                            break;
                    }
                    at += 12 + length;
                }
                Assert.True(sawEnd);

                var zlib = idat.ToArray();
                Assert.Equal(0x78, zlib[0]);
                Assert.Equal(0, ((zlib[0] << 8) | zlib[1]) % 31);
                var raw = new MemoryStream();
                using (var inflate = new DeflateStream(new MemoryStream(zlib, 2, zlib.Length - 6), CompressionMode.Decompress))
                {
                    inflate.CopyTo(raw);
                }
                var filtered = raw.ToArray();
                Assert.Equal(BigEndian(zlib, zlib.Length - 4), Adler(filtered));

                var stride = width * 3;
                Assert.Equal(height * (stride + 1), filtered.Length);
                var pixels = new byte[height * stride];
                for (var y = 0; y < height; y++)
                {
                    var type = filtered[y * (stride + 1)];
                    for (var i = 0; i < stride; i++)
                    {
                        int a = i >= 3 ? pixels[y * stride + i - 3] : 0;
                        int b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
                        int c = i >= 3 && y > 0 ? pixels[(y - 1) * stride + i - 3] : 0;
                        int predicted = type switch
                        {
                            0 => 0,
                            1 => a,
                            2 => b,
                            3 => (a + b) >> 1,
                            4 => Paeth(a, b, c),
                            _ => throw new InvalidDataException("filter type " + type),
                        };
                        pixels[y * stride + i] = (byte)(filtered[y * (stride + 1) + 1 + i] + predicted);
                    }
                }
                return new PngReader(width, height, pixels);
            }

            private static int Paeth(int a, int b, int c)
            {
                var p = a + b - c;
                int pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c);
                if (pa <= pb && pa <= pc) return a;
                return pb <= pc ? b : c;
            }

            private static uint BigEndian(byte[] b, int at) =>
                ((uint)b[at] << 24) | ((uint)b[at + 1] << 16) | ((uint)b[at + 2] << 8) | b[at + 3];

            private static uint Adler(byte[] bytes)
            {
                uint a = 1, b = 0;
                foreach (var x in bytes)
                {
                    a = (a + x) % 65521;
                    b = (b + a) % 65521;
                }
                return (b << 16) | a;
            }

            private static uint Crc(byte[] bytes)
            {
                var crc = 0xFFFFFFFFu;
                foreach (var x in bytes)
                {
                    crc ^= x;
                    for (var k = 0; k < 8; k++)
                    {
                        crc = (crc & 1) != 0 ? 0xEDB88320u ^ (crc >> 1) : crc >> 1;
                    }
                }
                return crc ^ 0xFFFFFFFFu;
            }
        }
    }
}
