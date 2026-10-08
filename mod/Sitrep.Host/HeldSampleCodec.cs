using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace Sitrep.Host
{
    /// <summary>
    /// A sample held for a craft that is out of contact, packed to a byte array
    /// and back without changing it.
    ///
    /// <para>The flattened tree a channel source returns costs about five times
    /// its wire size in managed heap (every node is a dictionary with slack and a
    /// boxed value per field), and a 68 part <c>vessel.parts</c> sample is 301 KB
    /// of it, arriving a few times a second. Packed and deflated it is about 14
    /// KB, which is what makes an outage of hours something the recorder can
    /// hold at all.</para>
    ///
    /// <para>The pack is lossless for the node types the flattener produces:
    /// <c>null</c>, <c>bool</c>, <c>int</c>, <c>long</c>, <c>double</c>,
    /// <c>string</c>, <c>double[]</c>, <c>List&lt;object?&gt;</c> and
    /// <c>Dictionary&lt;string, object?&gt;</c>. Each keeps its exact type and
    /// each dictionary its entry order, so the wire writer, which chooses its
    /// output by type, writes the unpacked sample exactly as it would have
    /// written the original. A tree holding anything else is not packed:
    /// <see cref="TryPack"/> says so and the caller holds the tree itself.</para>
    ///
    /// <para>Courier-thread-only: the scratch stream is shared.</para>
    /// </summary>
    internal sealed class HeldSampleCodec
    {
        private const byte TagNull = 0;
        private const byte TagFalse = 1;
        private const byte TagTrue = 2;
        private const byte TagDouble = 3;
        private const byte TagInt = 4;
        private const byte TagLong = 5;
        private const byte TagString = 6;
        private const byte TagDictionary = 7;
        private const byte TagList = 8;
        private const byte TagDoubleArray = 9;

        /// <summary>Below this many packed bytes deflate costs more than it saves.</summary>
        private const int DeflateFrom = 256;

        private const byte Raw = 0;
        private const byte Deflated = 1;

        private readonly MemoryStream _scratch = new MemoryStream();

        /// <summary>
        /// Pack <paramref name="value"/>. False when it holds a node type the pack
        /// does not round trip, in which case <paramref name="packed"/> is null.
        /// </summary>
        public bool TryPack(object? value, out byte[]? packed) => TryPack(value, out packed, out _);

        /// <param name="unpackedLength">The bytes of the pack before deflate: the size the sample travels at when released, near its wire size.</param>
        public bool TryPack(object? value, out byte[]? packed, out int unpackedLength)
        {
            _scratch.SetLength(0);
            _scratch.WriteByte(Raw);
            var writer = new BinaryWriter(_scratch, Encoding.UTF8, true);
            if (!Write(writer, value))
            {
                packed = null;
                unpackedLength = 0;
                return false;
            }
            writer.Flush();
            unpackedLength = (int)_scratch.Length - 1;

            if (_scratch.Length - 1 < DeflateFrom)
            {
                packed = _scratch.ToArray();
                return true;
            }

            using (var deflated = new MemoryStream())
            {
                deflated.WriteByte(Deflated);
                using (var zip = new DeflateStream(deflated, CompressionLevel.Fastest, true))
                {
                    zip.Write(_scratch.GetBuffer(), 1, (int)_scratch.Length - 1);
                }
                packed = deflated.ToArray();
            }
            return true;
        }

        /// <summary>The sample <see cref="TryPack"/> packed.</summary>
        public object? Unpack(byte[] packed)
        {
            if (packed[0] == Raw)
            {
                using (var plain = new MemoryStream(packed, 1, packed.Length - 1, false))
                using (var reader = new BinaryReader(plain, Encoding.UTF8, true))
                {
                    return Read(reader);
                }
            }

            using (var deflated = new MemoryStream(packed, 1, packed.Length - 1, false))
            using (var zip = new DeflateStream(deflated, CompressionMode.Decompress))
            using (var inflated = new MemoryStream())
            {
                zip.CopyTo(inflated);
                inflated.Position = 0;
                using (var reader = new BinaryReader(inflated, Encoding.UTF8, true))
                {
                    return Read(reader);
                }
            }
        }

        private static bool Write(BinaryWriter writer, object? value)
        {
            switch (value)
            {
                case null:
                    writer.Write(TagNull);
                    return true;
                case bool flag:
                    writer.Write(flag ? TagTrue : TagFalse);
                    return true;
                case double number:
                    writer.Write(TagDouble);
                    writer.Write(number);
                    return true;
                case int whole:
                    writer.Write(TagInt);
                    writer.Write(whole);
                    return true;
                case long wide:
                    writer.Write(TagLong);
                    writer.Write(wide);
                    return true;
                case string text:
                    writer.Write(TagString);
                    writer.Write(text);
                    return true;
                case double[] numbers:
                    writer.Write(TagDoubleArray);
                    writer.Write(numbers.Length);
                    foreach (var number in numbers)
                    {
                        writer.Write(number);
                    }
                    return true;
                case List<object?> items when value.GetType() == typeof(List<object?>):
                    writer.Write(TagList);
                    writer.Write(items.Count);
                    foreach (var item in items)
                    {
                        if (!Write(writer, item))
                        {
                            return false;
                        }
                    }
                    return true;
                case Dictionary<string, object?> entries when value.GetType() == typeof(Dictionary<string, object?>):
                    writer.Write(TagDictionary);
                    writer.Write(entries.Count);
                    foreach (var entry in entries)
                    {
                        writer.Write(entry.Key);
                        if (!Write(writer, entry.Value))
                        {
                            return false;
                        }
                    }
                    return true;
                default:
                    return false;
            }
        }

        private static object? Read(BinaryReader reader)
        {
            switch (reader.ReadByte())
            {
                case TagNull:
                    return null;
                case TagFalse:
                    return false;
                case TagTrue:
                    return true;
                case TagDouble:
                    return reader.ReadDouble();
                case TagInt:
                    return reader.ReadInt32();
                case TagLong:
                    return reader.ReadInt64();
                case TagString:
                    return reader.ReadString();
                case TagDoubleArray:
                    var numbers = new double[reader.ReadInt32()];
                    for (var i = 0; i < numbers.Length; i++)
                    {
                        numbers[i] = reader.ReadDouble();
                    }
                    return numbers;
                case TagList:
                    var count = reader.ReadInt32();
                    var items = new List<object?>(count);
                    for (var i = 0; i < count; i++)
                    {
                        items.Add(Read(reader));
                    }
                    return items;
                case TagDictionary:
                    var size = reader.ReadInt32();
                    var entries = new Dictionary<string, object?>(size);
                    for (var i = 0; i < size; i++)
                    {
                        var key = reader.ReadString();
                        entries[key] = Read(reader);
                    }
                    return entries;
                default:
                    throw new InvalidDataException("unknown held-sample tag");
            }
        }
    }
}
