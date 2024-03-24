# physical.hh 文件解析

physical 以及相关的文件表示着最直接的物理内存，也就是 gem5 真正的内存数据存储处。

在文件的开始，首先定义了一个 `BackingStoreEntry` 类:

```cpp
class BackingStoreEntry
{
  public:

    /**
     * Create a backing store entry. Don't worry about managing the memory
     * pointers, because PhysicalMemory is responsible for that.
     */
    BackingStoreEntry(AddrRange range, uint8_t* pmem,
                      bool conf_table_reported, bool in_addr_map, bool kvm_map,
                      int shm_fd=-1, off_t shm_offset=0)
        : range(range), pmem(pmem), confTableReported(conf_table_reported),
          inAddrMap(in_addr_map), kvmMap(kvm_map), shmFd(shm_fd),
          shmOffset(shm_offset)
        {}

    /**
     * The address range covered in the guest.
     */
     AddrRange range;

    /**
     * Pointer to the host memory this range maps to. This memory is the same
     * size as the range field.
     */
     uint8_t* pmem;

     // ... 
};
```

`BackingStoreEntry` 类主要表示一块后备存储空间，或者说是备用的存储空间，其中包含了 `AddrRange` 类的成员和 `uint8_t* pmem` 这块动态分配出的空间，这两者的数值是相等的，后续还包含了一堆 bool 成员，表示某些配置。`BackingStoreEntry` 是由后续的 `PhysicalMemory` 管理的。

`PhysicalMemory` 类的定义如下：

```cpp
class PhysicalMemory : public Serializable
{
  private:

    // Name for debugging
    std::string _name;

    // Global address map
    AddrRangeMap<AbstractMemory*, 1> addrMap;

    // All address-mapped memories
    std::vector<AbstractMemory*> memories;

    // The total memory size
    uint64_t size;

    // Let the user choose if we reserve swap space when calling mmap
    const bool mmapUsingNoReserve;

    const std::string sharedBackstore;
    uint64_t sharedBackstoreSize;

    long pageSize;

    // The physical memory used to provide the memory in the simulated
    // system
    std::vector<BackingStoreEntry> backingStore;

    // Prevent copying
    PhysicalMemory(const PhysicalMemory&);

    // Prevent assignment
    PhysicalMemory& operator=(const PhysicalMemory&);

    /**
     * Create the memory region providing the backing store for a
     * given address range that corresponds to a set of memories in
     * the simulated system.
     *
     * @param range The address range covered
     * @param memories The memories this range maps to
     * @param kvm_map Should KVM map this memory for the guest
     */
    void createBackingStore(AddrRange range,
                            const std::vector<AbstractMemory*>& _memories,
                            bool conf_table_reported,
                            bool in_addr_map, bool kvm_map);
}
```

`addrMap` 成员维护的是从一个地址范围到抽象内存的映射。`memories` 成员维护了所有的 `AbstractMemory`。`size` 记录内存总大小。`sharedBackstoreSize` 记录了共享的后备存储的大小。`pageSize` 记录了内存页的大小。`backingStore` 维护了所有的后备存储空间。将拷贝构造和拷贝运算符设置为私有，表示不希望进行拷贝，这两个构造函数被删除。`createBackingStore` 是一个私有的帮助函数，主要对给定的`AddrRange`，创建相应的后备存储，然后将这块后备存储关联到多个 `AbstractMemory` 上。而通过查看源文件中的代码实现可以发现，`createBackingStore` 实际上是在进行一个 mmap 的操作，后备存储其实就是一个 mmap，关联着一块磁盘地址。

```cpp
//class PhysicalMemory
{
  public:

    /**
     * Create a physical memory object, wrapping a number of memories.
     */
    PhysicalMemory(const std::string& _name,
                   const std::vector<AbstractMemory*>& _memories,
                   bool mmap_using_noreserve,
                   const std::string& shared_backstore,
                   bool auto_unlink_shared_backstore);

    /**
     * Unmap all the backing store we have used.
     */
    ~PhysicalMemory();

    /**
     * Return the name for debugging and for creation of sections for
     * checkpointing.
     */
    const std::string name() const { return _name; }

    /**
     * Check if a physical address is within a range of a memory that
     * is part of the global address map.
     *
     * @param addr A physical address
     * @return Whether the address corresponds to a memory
     */
    bool isMemAddr(Addr addr) const;

    /**
     * Get the memory ranges for all memories that are to be reported
     * to the configuration table. The ranges are merged before they
     * are returned such that any interleaved ranges appear as a
     * single range.
     *
     * @return All configuration table memory ranges
     */
    AddrRangeList getConfAddrRanges() const;

    /**
     * Get the total physical memory size.
     *
     * @return The sum of all memory sizes
     */
    uint64_t totalSize() const { return size; }

     /**
     * Get the pointers to the backing store for external host
     * access. Note that memory in the guest should be accessed using
     * access() or functionalAccess(). This interface is primarily
     * intended for CPU models using hardware virtualization. Note
     * that memories that are null are not present, and that the
     * backing store may also contain memories that are not part of
     * the OS-visible global address map and thus are allowed to
     * overlap.
     *
     * @return Pointers to the memory backing store
     */
    std::vector<BackingStoreEntry> getBackingStore() const
    { return backingStore; }

    /**
     * Perform an untimed memory access and update all the state
     * (e.g. locked addresses) and statistics accordingly. The packet
     * is turned into a response if required.
     *
     * @param pkt Packet performing the access
     */
    void access(PacketPtr pkt);

    /**
     * Perform an untimed memory read or write without changing
     * anything but the memory itself. No stats are affected by this
     * access. In addition to normal accesses this also facilitates
     * print requests.
     *
     * @param pkt Packet performing the access
     */
    void functionalAccess(PacketPtr pkt);

    // ... 

};
```

后续声明和定义的这些方法比较简单，主要是获取一些数值还有进行判断等等。

## 对 gem5 中模拟的物理内存的理解

这里直接引用 chatgpt 的回答：

> gem5模拟器在模拟物理内存时通常会使用内存映射文件（mmap文件）。这种方法允许gem5将一块虚拟地址空间映射到一个文件或者一个内存区域，这样就可以在不真正分配物理内存的情况下模拟出一个大的物理内存空间。使用mmap文件作为物理内存的模拟可以有效地管理和模拟大量的内存数据，同时还可以利用现有的文件系统和虚拟内存管理机制。
>
> 当gem5需要读写模拟的物理内存时，它实际上是在读写这个映射的文件或内存区域。这样做的好处是可以在不同的模拟运行之间保持内存数据的持久性，也可以方便地进行内存数据的检查和调试。
