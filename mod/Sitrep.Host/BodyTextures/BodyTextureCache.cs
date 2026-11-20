using System;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Sitrep.Host.BodyTextures
{
    /// <summary>
    /// Encoded body maps on disk, one file per body, named by the body and a key
    /// that changes whenever the texture it was made from, the size it was made
    /// at or the encoding does. Thread-safe: every call touches only its own
    /// body's files.
    /// </summary>
    public sealed class BodyTextureCache
    {
        /// <summary>Moves whenever <see cref="BodyTexturePng"/> or the size rule would make different bytes from the same texture.</summary>
        public const int EncodingVersion = 1;

        private const string Extension = ".png";

        private readonly string _directory;

        public BodyTextureCache(string directory)
        {
            _directory = directory ?? throw new ArgumentNullException(nameof(directory));
        }

        /// <summary>The folder the maps are kept in.</summary>
        public string Directory => _directory;

        /// <summary>
        /// The cache key for <paramref name="texture"/> encoded at
        /// <paramref name="width"/> by <paramref name="height"/>: 16 hexadecimal
        /// digits of a SHA-256 over the body, the texture's name, size, format
        /// and mipmap count, the output size and <see cref="EncodingVersion"/>.
        /// </summary>
        public static string Key(BodyTextureDescription texture, int width, int height)
        {
            var identity = string.Join("\n", new[]
            {
                texture.Body,
                texture.TextureName,
                texture.Width.ToString(CultureInfo.InvariantCulture),
                texture.Height.ToString(CultureInfo.InvariantCulture),
                texture.Format,
                texture.MipCount.ToString(CultureInfo.InvariantCulture),
                width.ToString(CultureInfo.InvariantCulture),
                height.ToString(CultureInfo.InvariantCulture),
                EncodingVersion.ToString(CultureInfo.InvariantCulture),
            });
            using var sha = SHA256.Create();
            var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(identity));
            var sb = new StringBuilder(16);
            for (var i = 0; i < 8; i++)
            {
                sb.Append(hash[i].ToString("x2", CultureInfo.InvariantCulture));
            }
            return sb.ToString();
        }

        /// <summary>The file a body's map is kept in under <paramref name="key"/>.</summary>
        public string PathFor(string body, string key) =>
            Path.Combine(_directory, BodyTextureWire.Key(body) + "." + key + Extension);

        /// <summary>The kept map for <paramref name="body"/> under <paramref name="key"/>, or null when there is none or it cannot be read.</summary>
        public byte[]? TryRead(string body, string key)
        {
            var path = PathFor(body, key);
            try
            {
                return File.Exists(path) ? File.ReadAllBytes(path) : null;
            }
            catch (IOException)
            {
                return null;
            }
            catch (UnauthorizedAccessException)
            {
                return null;
            }
        }

        /// <summary>
        /// Keeps <paramref name="png"/> as the map for <paramref name="body"/>
        /// under <paramref name="key"/> and deletes the body's maps kept under any
        /// other key. Written to a temporary file and moved into place, so a
        /// reader never sees half a file.
        /// </summary>
        public void Write(string body, string key, byte[] png)
        {
            System.IO.Directory.CreateDirectory(_directory);
            var path = PathFor(body, key);
            var temporary = path + ".tmp";
            File.WriteAllBytes(temporary, png);
            if (File.Exists(path))
            {
                File.Delete(path);
            }
            File.Move(temporary, path);

            var prefix = BodyTextureWire.Key(body) + ".";
            foreach (var other in System.IO.Directory.GetFiles(_directory, prefix + "*" + Extension))
            {
                var name = Path.GetFileName(other);
                var otherKey = name.Substring(prefix.Length, name.Length - prefix.Length - Extension.Length);
                if (otherKey != key && otherKey.IndexOf('.') < 0)
                {
                    File.Delete(other);
                }
            }
        }
    }
}
