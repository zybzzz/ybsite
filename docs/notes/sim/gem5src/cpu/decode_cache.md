# cpu decode cache

一个简易的 cache，简单的来讲就是给出内存的地址，然后返回 cache 记录的内存内容。

```cpp
/// A sparse map from an Addr to a Value, stored in page chunks.
template<class Value, Addr CacheChunkShift = 12>
class AddrMap
{
  // Value 记录的就是最终要返回的内容
  protected:
    static constexpr Addr CacheChunkBytes = 1ULL << CacheChunkShift;

    // 计算某个内存地址相对于内存块的 offset 
    static constexpr Addr
    chunkOffset(Addr addr)
    {
        return addr & (CacheChunkBytes - 1);
    }

    // 计算块的基地址
    static constexpr Addr
    chunkStart(Addr addr)
    {
        return addr & ~(CacheChunkBytes - 1);
    }

    // cache 的内容返回的是 value
    // A chunk of cache entries.
    struct CacheChunk
    {
        Value items[CacheChunkBytes];
    };
    // A map of cache chunks which allows a sparse mapping.
    typedef typename std::unordered_map<Addr, CacheChunk *> ChunkMap;
    typedef typename ChunkMap::iterator ChunkIt;
    // Mini cache of recent lookups.
    ChunkIt recent[2];
    ChunkMap chunkMap;

    /// Update the mini cache of recent lookups.
    /// @param recentest The most recent result;
    void
    update(ChunkIt recentest)
    {
        recent[1] = recent[0];
        recent[0] = recentest;
    }

    /// Attempt to find the CacheChunk which goes with a particular
    /// address. First check the small cache of recent results, then
    /// actually look in the hash map.
    /// @param addr The address to look up.
    /// 加速查找采取的措施，先查最近的两个，找不到再到 map 中找
    CacheChunk *
    getChunk(Addr addr)
    {
        Addr chunk_addr = chunkStart(addr);

        // Check against recent lookups.
        if (recent[0] != chunkMap.end()) {
            if (recent[0]->first == chunk_addr)
                return recent[0]->second;
            if (recent[1] != chunkMap.end() &&
                    recent[1]->first == chunk_addr) {
                update(recent[1]);
                // recent[1] has just become recent[0].
                return recent[0]->second;
            }
        }

        // Actually look in the hash_map.
        ChunkIt it = chunkMap.find(chunk_addr);
        if (it != chunkMap.end()) {
            update(it);
            return it->second;
        }

        // Didn't find an existing chunk, so add a new one.
        CacheChunk *newChunk = new CacheChunk;
        typename ChunkMap::value_type to_insert(chunk_addr, newChunk);
        // 同时更新 map
        update(chunkMap.insert(to_insert).first);
        return newChunk;
    }

  public:
    /// Constructor
    AddrMap()
    {
        recent[0] = recent[1] = chunkMap.end();
    }

    // 返回待查找 value 的 引用
    Value &
    lookup(Addr addr)
    {
        CacheChunk *chunk = getChunk(addr);
        return chunk->items[chunkOffset(addr)];
    }
};

```