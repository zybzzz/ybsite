# System.hh 解析

在这里解析 System.hh 这一系列文件，`System` 这个类在 gem5 中起到了重要的作用，他是整个全局模拟的计算机系统的抽象，管理着全局的信息。

首先从类的定义中：

```cpp
class System : public SimObject, public PCEventScope
```

`System` 继承自 `SimObject`，表示其有调度普通事件的能力，同时继承自 `PCEventScope`，表示其具有调度 `PCEvent` 的能力。

```cpp
// class System
{
  private:

    /**
     * Private class for the system port which is only used as a
     * requestor for debug access and for non-structural entities that do
     * not have a port of their own.
     */
    class SystemPort : public RequestPort
    {
      public:

        /**
         * Create a system port with a name and an owner.
         */
        SystemPort(const std::string &_name)
            : RequestPort(_name)
        { }

        bool
        recvTimingResp(PacketPtr pkt) override
        {
            panic("SystemPort does not receive timing!");
        }

        void
        recvReqRetry() override
        {
            panic("SystemPort does not expect retry!");
        }
    };

    std::list<PCEvent *> liveEvents;
    SystemPort _systemPort;

    // Map of memory address ranges for devices with their own backing stores
    std::unordered_map<RequestorID, std::vector<memory::AbstractMemory *>>
        deviceMemMap;
}
```

首先开始先定义了一个内部类，用于调试时候的请求操作，随后在类中声明了这个内部类的成员 `_systemPort`。声明了 `liveEvents`，通过这个名字可以简单的理解这是当前的活动对象。随后定义了 `deviceMemMap` 用于单个 `RequestorID` 到其涉及到的内存的转换。

```cpp
// class System
{
    class Threads
    {
      private:
        struct Thread
        {
            ThreadContext *context = nullptr;
            bool active = false;
            Event *resumeEvent = nullptr;

            void resume();
            std::string name() const;
            void quiesce() const;
        };

        std::vector<Thread> threads;

        Thread &
        thread(ContextID id)
        {
            assert(id < size());
            return threads[id];
        }

        const Thread &
        thread(ContextID id) const
        {
            assert(id < size());
            return threads[id];
        }

        void insert(ThreadContext *tc);
        void replace(ThreadContext *tc, ContextID id);

        friend class System;

      public:
        class const_iterator
        {
          private:
            Threads const* threads;
            int pos;

            friend class Threads;

            const_iterator(const Threads &_threads, int _pos) :
                threads(&_threads), pos(_pos)
            {}

          public:
            using iterator_category = std::forward_iterator_tag;
            using value_type = ThreadContext *;
            using difference_type = int;
            using pointer = const value_type *;
            using reference = const value_type &;

            const_iterator &
            operator ++ ()
            {
                pos++;
                return *this;
            }

            const_iterator
            operator ++ (int)
            {
                return const_iterator(*threads, pos++);
            }

            reference operator * () { return threads->thread(pos).context; }
            pointer operator -> () { return &threads->thread(pos).context; }

            bool
            operator == (const const_iterator &other) const
            {
                return threads == other.threads && pos == other.pos;
            }

            bool
            operator != (const const_iterator &other) const
            {
                return !(*this == other);
            }
        };

        ThreadContext *findFree();

        ThreadContext *
        operator [](ContextID id) const
        {
            return thread(id).context;
        }

        void markActive(ContextID id) { thread(id).active = true; }

        int size() const { return threads.size(); }
        bool empty() const { return threads.empty(); }
        int numRunning() const;
        int
        numActive() const
        {
            int count = 0;
            for (auto &thread: threads) {
                if (thread.active)
                    count++;
            }
            return count;
        }

        void quiesce(ContextID id);
        void quiesceTick(ContextID id, Tick when);

        const_iterator begin() const { return const_iterator(*this, 0); }
        const_iterator end() const { return const_iterator(*this, size()); }
    };
}
```

随后定义了内部类 `Threads`，用来组织当前系统中所有的线程，在这个内部类的内部又抽象了线程的概念，简单的理解，一个线程就是简单的维护了 `ThreadContext` 的状态。`Threads` 实际上是在维护 `std::vector<Thread> threads` 成员。随后在内部声明了 `thread`、`insert`、`replace` 方法用来访问线程组中的成员、向线程组中插入某个线程、替换线程组中的线程。最后将 `System` 声明为这个 `Threads` 类的友元。

在 `public` 域中，定义了 `const_iterator` 内部类，这个类能让外部访问线程，但是不能改变线程的值。声明了 `findFree`，在后续的定义中，`findFree` 找到线程组中已经 `Halted` 的线程。重载了下标访问方法，能够通过线程 id 取出线程组中的相应线程。`markActive` 将某个线程的状态标记为活动的。`numRunning` 和 `numActive` 表示相关状态的线程数。`quiesce` 和 `quiesceTick` 用来休眠线程。最后提供两个迭代器。

```cpp
//class System
{
    /**
     * Get a reference to the system port that can be used by
     * non-structural simulation objects like processes or threads, or
     * external entities like loaders and debuggers, etc, to access
     * the memory system.
     *
     * @return a reference to the system port we own
     */
    RequestPort& getSystemPort() { return _systemPort; }

    /**
     * Additional function to return the Port of a memory object.
     */
    Port &getPort(const std::string &if_name,
                  PortID idx=InvalidPortID) override;

    /** @{ */
    /**
     * Is the system in atomic mode?
     *
     * There are currently two different atomic memory modes:
     * 'atomic', which supports caches; and 'atomic_noncaching', which
     * bypasses caches. The latter is used by hardware virtualized
     * CPUs. SimObjects are expected to use Port::sendAtomic() and
     * Port::recvAtomic() when accessing memory in this mode.
     */
    bool
    isAtomicMode() const
    {
        return memoryMode == enums::atomic ||
            memoryMode == enums::atomic_noncaching;
    }

    /**
     * Is the system in timing mode?
     *
     * SimObjects are expected to use Port::sendTiming() and
     * Port::recvTiming() when accessing memory in this mode.
     */
    bool isTimingMode() const { return memoryMode == enums::timing; }

    /**
     * Should caches be bypassed?
     *
     * Some CPUs need to bypass caches to allow direct memory
     * accesses, which is required for hardware virtualization.
     */
    bool
    bypassCaches() const
    {
        return memoryMode == enums::atomic_noncaching;
    }
    /** @} */

    /** @{ */
    /**
     * Get the memory mode of the system.
     *
     * \warn This should only be used by the Python world. The C++
     * world should use one of the query functions above
     * (isAtomicMode(), isTimingMode(), bypassCaches()).
     */
    enums::MemoryMode getMemoryMode() const { return memoryMode; }

    /**
     * Change the memory mode of the system.
     *
     * \warn This should only be called by the Python!
     *
     * @param mode Mode to change to (atomic/timing/...)
     */
    void setMemoryMode(enums::MemoryMode mode);
    /** @} */

    /**
     * Get the cache line size of the system.
     */
    Addr cacheLineSize() const { return _cacheLineSize; }
}
```

随后定义的都是很简单的函数，用来获取 port。检查访问内存的模式、设置绕过cache、获取缓存行的大小。

```cpp
// class System
{
    Threads threads;

    const bool multiThread;

    using SimObject::schedule;

    bool schedule(PCEvent *event) override;
    bool remove(PCEvent *event) override;

    uint64_t init_param;

    /** Port to physical memory used for writing object files into ram at
     * boot.*/
    PortProxy physProxy;

    /** OS kernel */
    Workload *workload = nullptr;
}
```

这里创建出了 `Threads` 类的对象，设置 bool 变量表示是否开启多线程。对于 `schedule` 方法，`using SimObject::schedule;` 表示这个类可以调用 SimObject 的 `schedule` 方法，`bool schedule(PCEvent *event) override;` 表示这个类可以调用 `PCEventScope` 的 `schedule` 方法，同时这个方法在这个类中被重写了。`PCEventScope` 中的 `remove` 同样在这个类中被重写。声明一个 `PortProxy` 用作对于内存的访问。`workload` 等于要模拟的程序，全系统模式下，这等于操作系统内核。

```cpp
{
    public:
    /**
     * Get a pointer to the Kernel Virtual Machine (KVM) SimObject,
     * if present.
     */
    KvmVM *getKvmVM() const { return kvmVM; }

    /**
     * Set the pointer to the Kernel Virtual Machine (KVM) SimObject. For use
     * by that object to declare itself to the system.
     */
    void setKvmVM(KvmVM *const vm) { kvmVM = vm; }

    /** Get a pointer to access the physical memory of the system */
    memory::PhysicalMemory& getPhysMem() { return physmem; }
    const memory::PhysicalMemory& getPhysMem() const { return physmem; }

    /** Amount of physical memory that exists */
    Addr memSize() const;

    /**
     * Check if a physical address is within a range of a memory that
     * is part of the global address map.
     *
     * @param addr A physical address
     * @return Whether the address corresponds to a memory
     */
    bool isMemAddr(Addr addr) const;

    /**
     * Add a physical memory range for a device. The ranges added here will
     * be considered a non-PIO memory address if the requestorId of the packet
     * and range match something in the device memory map.
     */
    void addDeviceMemory(RequestorID requestorId,
        memory::AbstractMemory *deviceMemory);

    /**
     * Similar to isMemAddr but for devices. Checks if a physical address
     * of the packet match an address range of a device corresponding to the
     * RequestorId of the request.
     */
    bool isDeviceMemAddr(const PacketPtr& pkt) const;

    /**
     * Return a pointer to the device memory.
     */
    memory::AbstractMemory *getDeviceMemory(const PacketPtr& pkt) const;

    /*
     * Return the list of address ranges backed by a shadowed ROM.
     *
     * @return List of address ranges backed by a shadowed ROM
     */
    AddrRangeList getShadowRomRanges() const { return ShadowRomRanges; }

    /**
     * Get the guest byte order.
     */
    ByteOrder
    getGuestByteOrder() const
    {
        return workload->byteOrder();
    }

    /**
     * The thermal model used for this system (if any).
     */
    ThermalModel * getThermalModel() const { return thermalModel; }

  protected:

    KvmVM *kvmVM = nullptr;

    memory::PhysicalMemory physmem;

    AddrRangeList ShadowRomRanges;

    enums::MemoryMode memoryMode;

    const Addr _cacheLineSize;

    uint64_t workItemsBegin = 0;
    uint64_t workItemsEnd = 0;
    uint32_t numWorkIds;

    /** This array is a per-system list of all devices capable of issuing a
     * memory system request and an associated string for each requestor id.
     * It's used to uniquely id any requestor in the system by name for things
     * like cache statistics.
     */
    std::vector<RequestorInfo> requestors;

    ThermalModel * thermalModel;
}
```

除去 kvm 的相关成员外，这里声明的成员变量和成员方法主要都和获取内存相关的参数有关。需要注意的是 `std::vector<RequestorInfo> requestors;` 这个 vector 中记录的就是 Requestor 的相关信息。`thermalModel` 保存着整个系统的热模型。

```cpp
{
  protected:
    /**
     * Strips off the system name from a requestor name
     */
    std::string stripSystemName(const std::string& requestor_name) const;

  public:

    /**
     * Request an id used to create a request object in the system. All objects
     * that intend to issues requests into the memory system must request an id
     * in the init() phase of startup. All requestor ids must be fixed by the
     * regStats() phase that immediately precedes it. This allows objects in
     * the memory system to understand how many requestors may exist and
     * appropriately name the bins of their per-requestor stats before the
     * stats are finalized.
     *
     * Registers a RequestorID:
     * This method takes two parameters, one of which is optional.
     * The first one is the requestor object, and it is compulsory; in case
     * a object has multiple (sub)requestors, a second parameter must be
     * provided and it contains the name of the subrequestor. The method will
     * create a requestor's name by concatenating the SimObject name with the
     * eventual subrequestor string, separated by a dot.
     *
     * As an example:
     * For a cpu having two requestors: a data requestor and an
     * instruction requestor,
     * the method must be called twice:
     *
     * instRequestorId = getRequestorId(cpu, "inst");
     * dataRequestorId = getRequestorId(cpu, "data");
     *
     * and the requestors' names will be:
     * - "cpu.inst"
     * - "cpu.data"
     *
     * @param requestor SimObject related to the requestor
     * @param subrequestor String containing the subrequestor's name
     * @return the requestor's ID.
     */
    RequestorID getRequestorId(const SimObject* requestor,
                         std::string subrequestor={});

    /**
     * Registers a GLOBAL RequestorID, which is a RequestorID not related
     * to any particular SimObject; since no SimObject is passed,
     * the requestor gets registered by providing the full requestor name.
     *
     * @param requestorName full name of the requestor
     * @return the requestor's ID.
     */
    RequestorID getGlobalRequestorId(const std::string& requestor_name);

    /**
     * Get the name of an object for a given request id.
     */
    std::string getRequestorName(RequestorID requestor_id);

    /**
     * Looks up the RequestorID for a given SimObject
     * returns an invalid RequestorID (invldRequestorId) if not found.
     */
    RequestorID lookupRequestorId(const SimObject* obj) const;

    /**
     * Looks up the RequestorID for a given object name string
     * returns an invalid RequestorID (invldRequestorId) if not found.
     */
    RequestorID lookupRequestorId(const std::string& name) const;

    /** Get the number of requestors registered in the system */
    RequestorID maxRequestors() { return requestors.size(); }

  protected:
    /** helper function for getRequestorId */
    RequestorID _getRequestorId(const SimObject* requestor,
                          const std::string& requestor_name);

    /**
     * Helper function for constructing the full (sub)requestor name
     * by providing the root requestor and the relative subrequestor name.
     */
    std::string leafRequestorName(const SimObject* requestor,
                               const std::string& subrequestor);
}
```

剩下声明的这堆成员方法都和系统中的 request 有关。`stripSystemName` 根据传入的 request name，将 request name 中的系统名删去。`getRequestorId` 用于分配 request id，根据其注释，想要进行内存访问的对象都要在其 init 函数调用的时候进行 request id 的分配，当某个模块想要访问内存的时候需要传入模块对象（SimObject）和请求的名称来正式创建一个请求。`getGlobalRequestorId` 则用来创建一个全局访问的内存请求，这个内存请求不和任何模块相关联。两种`lookupRequestorId`方法分别用来通过 SimObject 对象和 request name 来获取 request id。`maxRequestors` 用来获取当前总共的内存请求的数目。

```cpp
//class System
{
    public:
        void regStats() override;
        /**
        * Called by pseudo_inst to track the number of work items started by this
        * system.
        */
        uint64_t
        incWorkItemsBegin()
        {
            return ++workItemsBegin;
        }

        /**
        * Called by pseudo_inst to track the number of work items completed by
        * this system.
        */
        uint64_t
        incWorkItemsEnd()
        {
            return ++workItemsEnd;
        }

        /**
        * Called by pseudo_inst to mark the cpus actively executing work items.
        * Returns the total number of cpus that have executed work item begin or
        * ends.
        */
        int
        markWorkItem(int index)
        {
            threads.markActive(index);
            return threads.numActive();
        }

        void
        workItemBegin(uint32_t tid, uint32_t workid)
        {
            std::pair<uint32_t, uint32_t> p(tid, workid);
            lastWorkItemStarted[p] = curTick();
        }

        void workItemEnd(uint32_t tid, uint32_t workid);

        /* Returns whether we successfully trapped into GDB. */
        bool trapToGdb(GDBSignal signal, ContextID ctx_id) const;
}
```

这部分主要用来激活线程组中的某个线程，并重置线程开始的时间。

```cpp
{
  protected:
    /**
     * Range for memory-mapped m5 pseudo ops. The range will be
     * invalid/empty if disabled.
     */
    const AddrRange _m5opRange;

  public:
    PARAMS(System);

    System(const Params &p);
    ~System();

    /**
     * Range used by memory-mapped m5 pseudo-ops if enabled. Returns
     * an invalid/empty range if disabled.
     */
    const AddrRange &m5opRange() const { return _m5opRange; }

  public:

    void registerThreadContext(ThreadContext *tc);
    void replaceThreadContext(ThreadContext *tc, ContextID context_id);

    void serialize(CheckpointOut &cp) const override;
    void unserialize(CheckpointIn &cp) override;

  public:
    std::map<std::pair<uint32_t, uint32_t>, Tick>  lastWorkItemStarted;
    std::map<uint32_t, statistics::Histogram*> workItemStats;
}
```

这部分主要是为 m5op 分配了内存空间。

```cpp
//class System
{
    static std::vector<System *> systemList;
    static int numSystemsRunning;

    static void printSystems();

    FutexMap futexMap;

    static const int maxPID = 32768;

    /** Process set to track which PIDs have already been allocated */
    std::set<int> PIDs;

    // By convention, all signals are owned by the receiving process. The
    // receiver will delete the signal upon reception.
    std::list<BasicSignal> signalList;

    // Used by syscall-emulation mode. This member contains paths which need
    // to be redirected to the faux-filesystem (a duplicate filesystem
    // intended to replace certain files on the host filesystem).
    std::vector<RedirectPath*> redirectPaths;
}
```

这部分定义了一些静态变量，如 `systemList` 应该是全局的 `System` 列表。`signalList` 应该是进程间信号传递的列表。`redirectPaths` 则表示在se模式下的路径映射。
