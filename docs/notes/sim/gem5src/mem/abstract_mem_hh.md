# abstract_mem 模块解析

主要解析 `abstract_mem.hh` 、`abstract_mem.cc` 的内容解析。主要涉及 `LockedAddr` 和 `AbstractMemory` 这两个类。

首先给出 `LockedAddr` 的代码：

```cpp
/**
 * Locked address class that represents a physical address and a
 * context id.
 */
class LockedAddr
{

  private:

    // on alpha, minimum LL/SC granularity is 16 bytes, so lower
    // bits need to masked off.
    static const Addr Addr_Mask = 0xf;

  public:

    // locked address
    Addr addr;

    // locking hw context
    const ContextID contextId;

    static Addr mask(Addr paddr) { return (paddr & ~Addr_Mask); }

    // check for matching execution context
    bool matchesContext(const RequestPtr &req) const
    {
        assert(contextId != InvalidContextID);
        assert(req->hasContextId());
        return (contextId == req->contextId());
    }

    LockedAddr(const RequestPtr &req) : addr(mask(req->getPaddr())),
                                        contextId(req->contextId())
    {}

    // constructor for unserialization use
    LockedAddr(Addr _addr, int _cid) : addr(_addr), contextId(_cid)
    {}
};
```

如这个类的注释所说，这里是将一个 thread_context_id 和一个屋里地址进行关联，仅此而已，类方法也只是简单的构造函数。还有检测的时候检测当前的 `LockedAddr` 对象和给出的线程 id 是否匹配的问题。

随后定义了 `AbstractMemory`，这个类简单的抽象了一片地址范围，并且简单的实现了一点读写功能。这个类成为了后续 `MemInterface` 的基类。下面简单的介绍一下这个类。

以下详细介绍这个类的实现：

```cpp
class AbstractMemory : public ClockedObject
{
  protected:

    // Address range of this memory
    AddrRange range;

    // Pointer to host memory used to implement this memory
    uint8_t* pmemAddr;

    // Backdoor to access this memory.
    MemBackdoor backdoor;

    // Enable specific memories to be reported to the configuration table
    const bool confTableReported;

    // Should the memory appear in the global address map
    const bool inAddrMap;

    // Should KVM map this memory for the guest
    const bool kvmMap;

    // Are writes allowed to this memory
    const bool writeable;

    std::list<LockedAddr> lockedAddrList;

    // helper function for checkLockedAddrs(): we really want to
    // inline a quick check for an empty locked addr list (hopefully
    // the common case), and do the full list search (if necessary) in
    // this out-of-line function
    bool checkLockedAddrList(PacketPtr pkt);

    // Record the address of a load-locked operation so that we can
    // clear the execution context's lock flag if a matching store is
    // performed
    void trackLoadLocked(PacketPtr pkt);

    // Compare a store address with any locked addresses so we can
    // clear the lock flag appropriately.  Return value set to 'false'
    // if store operation should be suppressed (because it was a
    // conditional store and the address was no longer locked by the
    // requesting execution context), 'true' otherwise.  Note that
    // this method must be called on *all* stores since even
    // non-conditional stores must clear any matching lock addresses.
    bool
    writeOK(PacketPtr pkt)
    {
        const RequestPtr &req = pkt->req;
        if (!writeable)
            return false;
        if (lockedAddrList.empty()) {
            // no locked addrs: nothing to check, store_conditional fails
            bool isLLSC = pkt->isLLSC();
            if (isLLSC) {
                req->setExtraData(0);
            }
            return !isLLSC; // only do write if not an sc
        } else {
            // iterate over list...
            return checkLockedAddrList(pkt);
        }
    }
    // ... 
}
```

首先定义的是一块地址范围和成员变量，可以看到这个成员变量中包含了这一块内存对应的内存后门的对象，以及这块内存内存区域是否可写，最重要的是 `pmemAddr`，这个指针应该指向了真正存储数据的地址。后紧跟了 `std::list<LockedAddr> lockedAddrList` 应该指定的是这一块内存中的锁定的地址，也就是说和特定进程相关的地址。

源码中定义了 `trackLoadLocked`，其实现：

```cpp
void
AbstractMemory::trackLoadLocked(PacketPtr pkt)
{
    const RequestPtr &req = pkt->req;
    Addr paddr = LockedAddr::mask(req->getPaddr());

    // first we check if we already have a locked addr for this
    // xc.  Since each xc only gets one, we just update the
    // existing record with the new address.
    std::list<LockedAddr>::iterator i;

    for (i = lockedAddrList.begin(); i != lockedAddrList.end(); ++i) {
        if (i->matchesContext(req)) {
            DPRINTF(LLSC, "Modifying lock record: context %d addr %#x\n",
                    req->contextId(), paddr);
            i->addr = paddr;
            return;
        }
    }

    // no record for this xc: need to allocate a new one
    DPRINTF(LLSC, "Adding lock record: context %d addr %#x\n",
            req->contextId(), paddr);
    lockedAddrList.push_front(LockedAddr(req));
    backdoor.invalidate();
}
```

可以看到这实际上是从请求中获取到了请求需要访问的地址，再检查 `lockedAddrList` 中是否存在一项 `lockedAddr` 与请求的线程 id 相同，如果有的话直接更改这一项，将 lock 的物理地址改成当前要访问的物理地址，如果没有则产生新的一项，插入到队列中，并使后门失效。

后续还定义了 `checkLockedAddrList` 方法，这个方法在需要进行内存写的时候访问，主要检查的就是 `lockedAddrList`，防止写的时候产生读写冲突。定义了 `writeOK` 方法来检查对一个内存的写是否允许。

```cpp
/**
     * See if this is a null memory that should never store data and
     * always return zero.
     *
     * @return true if null
     */
    bool isNull() const { return params().null; }

    /**
     * Set the host memory backing store to be used by this memory
     * controller.
     *
     * @param pmem_addr Pointer to a segment of host memory
     */
    void setBackingStore(uint8_t* pmem_addr);

    void
    getBackdoor(MemBackdoorPtr &bd_ptr)
    {
        if (lockedAddrList.empty() && backdoor.ptr())
            bd_ptr = &backdoor;
    }

    /**
     * Get the list of locked addresses to allow checkpointing.
     */
    const std::list<LockedAddr> &
    getLockedAddrList() const
    {
        return lockedAddrList;
    }

    /**
     * Add a locked address to allow for checkpointing.
     */
    void
    addLockedAddr(LockedAddr addr)
    {
        backdoor.invalidate();
        lockedAddrList.push_back(addr);
    }
```

后续定义了 4 个比较简单的 get/set 函数，逻辑都比较简单，其中 `isNull` 这个函数的返回值取决于 python 脚本文件中的配置。

```cpp
/**
     * Transform a gem5 address space address into its physical counterpart
     * in the host address space.
     *
     * @param addr Address in gem5's address space.
     * @return Pointer to the corresponding memory address of the host.
     */
    inline uint8_t *
    toHostAddr(Addr addr) const
    {
        return pmemAddr + addr - range.start();
    }

    /**
     * Get the memory size.
     *
     * @return the size of the memory
     */
    uint64_t size() const { return range.size(); }

    /**
     * Get the start address.
     *
     * @return the start address of the memory
     */
    Addr start() const { return range.start(); }

    /**
     *  Should this memory be passed to the kernel and part of the OS
     *  physical memory layout.
     *
     * @return if this memory is reported
     */
    bool isConfReported() const { return confTableReported; }

    /**
     * Some memories are used as shadow memories or should for other
     * reasons not be part of the global address map.
     *
     * @return if this memory is part of the address map
     */
    bool isInAddrMap() const { return inAddrMap; }

    /**
     * When shadow memories are in use, KVM may want to make one or the other,
     * but cannot map both into the guest address space.
     *
     * @return if this memory should be mapped into the KVM guest address space
     */
    bool isKvmMap() const { return kvmMap; }

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
```

最为关键的是 `toHostAddr`，这将 gem5 中的物理地址转化成实际的数据存储的地址，以供后续对实际数据的访问。后续还定义了 `access` 和 `functionalAccess` 方法，定义了两种 gem5 中访问内存的方法。
