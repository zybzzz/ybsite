# 访存相关

访存相关主要包括 LSQ 和 LSQ Unit，LSQ 基本在委托 LSQ Unit。目前 riscv 中还是没有硬件事务内存的支持的，暂时不考虑硬件事务内存相关的。

## 常见的一些重新发送内存请求的函数

1. retrydefer: 重试TLB缺失的
2. retrycancel：重试各种被取消的

## 初始化

lsq 和 lsq_unit 的初始化都很简单，基本都是简单的根据 python 脚本的参数赋值进行初始化。

## Load

### 指派、准备发射阶段

在指派进入保留站的时候进行插入到lsq的操作。

```cpp
void
LSQUnit::insertLoad(const DynInstPtr &load_inst)
{
    assert(!loadQueue.full());
    assert(loadQueue.size() < loadQueue.capacity());

    DPRINTF(LSQUnit, "Inserting load PC %s, idx:%i [sn:%lli]\n", load_inst->pcState(), loadQueue.tail(),
            load_inst->seqNum);

    /* Grow the queue. */
    loadQueue.advance_tail();

    load_inst->sqIt = storeQueue.end();

    assert(!loadQueue.back().valid());
    loadQueue.back().set(load_inst);
    load_inst->lqIdx = loadQueue.tail();
    assert(load_inst->lqIdx > 0);
    load_inst->lqIt = loadQueue.getIterator(load_inst->lqIdx);

    // htm ...
}

```

除去硬件事务内存相关的代码，这部分的代码还是很简单的，主要就是往 Load 队列里面加了一个指令，并且记住了指令的位置和位置迭代器，在插入的时候记录了在这个 load 插入时刻 store 队列中的 index，应该是用于内存顺序违反时候的判断。

在上面的操作之后，load 相关的操作还是会被插入到 inst_queue 中，进行相关的操作。调用 inst_queue insert 的时候，除了将指令插入到 instList 中以及依赖检查之外，还进行了以下的操作：

```cpp
if (inst->isMemRef()) {
    // insert and check memDep
    scheduler->memDepUnit[inst->threadNumber].insert(inst);
} else {
    addIfReady(inst);
}
```

对于非内存的指令，直接检查所有寄存器依赖已经满足，就将其移到 Ready 队列了，对于内存相关的，将其插入到了内存依赖分析的单元中进行内存依赖相关的分析，memdepunit 的 insert 代码(首先要有对这里的这个 dep 单元有最基本的理解，那就是他希望对内存相关的操作进行排序)。

首先介绍 `MemDepEntry`，这应该是 dep unit 中最基本的存储单元：

```cpp
class MemDepEntry
{
    public:
    //简单的构造函数，不做任何操作
    MemDepEntry(const DynInstPtr &new_inst);

    /** Frees any pointers. */
    // free element in dependInsts
    ~MemDepEntry();

    /** Returns the name of the memory dependence entry. */
    std::string name() const { return "memdepentry"; }

    /** The instruction being tracked. */
    DynInstPtr inst;

    // 当前这个单元在 inst list 中的迭代器
    ListIt listIt;

    // 这个指令依赖的指令
    // 简单的来讲这就指定了一个顺序
    // 只有在这个 vector 中的指令都执行完成之后才能进行本指令
    // 这就是一种顺序
    std::vector<MemDepEntryPtr> dependInsts;

    /** Number of memory dependencies that need to be satisfied. */
    // 需要满足的依赖数量，应该是上面那个 vector 的长度
    int memDeps = 0;
    /** If the instruction is completed. */
    // 当前指令是否完成
    bool completed = false;
    /** If the instruction is squashed. */
    // 当前指令是否被清空
    bool squashed = false;
};

```

```cpp
void
MemDepUnit::insert(const DynInstPtr &inst)
{
    ThreadID tid = inst->threadNumber;

    // 产生一个 entry
    MemDepEntryPtr inst_entry = std::make_shared<MemDepEntry>(inst);

    // Add the MemDepEntry to the hash.
    // 将上面产生的条目送到 hash 表
    memDepHash.insert(
        std::pair<InstSeqNum, MemDepEntryPtr>(inst->seqNum, inst_entry));
#ifdef DEBUG
    MemDepEntry::memdep_insert++;
#endif

    // 将这条指令送入 dep unit 维护的 instList 中
    instList[tid].push_back(inst);

    // 迭代器指向当前插入的指令
    inst_entry->listIt = --(instList[tid].end());

    // Check any barriers and the dependence predictor for any
    // producing memrefs/stores.
    // 这里变量的取名不是很好，实际上说这里找的并不是store
    // 这里要找的是当前这条指令需要等哪些指令执行完/或者说需要排在哪些指令的后面
    std::vector<InstSeqNum>  producing_stores;
    if ((inst->isLoad() || inst->isAtomic()) && hasLoadBarrier()) {
        DPRINTF(MemDepUnit, "%d load barriers in flight\n",
                loadBarrierSNs.size());
        // 如果当前是 load 指令，则需要排在 load 屏障的后面
        producing_stores.insert(std::end(producing_stores),
                                std::begin(loadBarrierSNs),
                                std::end(loadBarrierSNs));
    } else if ((inst->isStore() || inst->isAtomic()) && hasStoreBarrier()) {
        DPRINTF(MemDepUnit, "%d store barriers in flight\n",
                storeBarrierSNs.size());
        // 如果当前是 store 指令，则需要排在 store 屏障后面
        producing_stores.insert(std::end(producing_stores),
                                std::begin(storeBarrierSNs),
                                std::end(storeBarrierSNs));
    } else {
        std::vector<InstSeqNum> dep = {};
        if (inst->isLoad()) {
            // 如果没有屏障，则需要通过内存依赖预测单元找到
            // 内存依赖分析单元维护的猜测的是当前的 load 可能会和哪些 store 产生依赖关系
            // gem5 中的实现是 storeset
            dep = depPred.checkInst(inst->pcState().instAddr());
        }
        if (!dep.empty()) {
            for (int i=0;i<dep.size();i++) {
                // 如果 store set 反返回了一些可能存在的 store，就将其插入到 producing_stores 中
                producing_stores.push_back(dep[i]);
            }
        }
    }

    std::vector<MemDepEntryPtr> store_entries;

    // If there is a producing store, try to find the entry.
    // 对上面得到的序列号进行查找，看看他们到底完成没有
    // 如果没有完成，将其从表中找出来插入到 store_entries 中 
    for (auto producing_store : producing_stores) {
        DPRINTF(MemDepUnit, "Searching for producer [sn:%lli]\n",
                            producing_store);
        MemDepHashIt hash_it = memDepHash.find(producing_store);

        if (hash_it != memDepHash.end()) {
            store_entries.push_back((*hash_it).second);
            DPRINTF(MemDepUnit, "Producer found\n");
        }
    }

    // If no store entry, then instruction can issue as soon as the registers
    // are ready.
    // 如果没有任何的依赖或者说顺序关系被检查到
    if (store_entries.empty()) {
        DPRINTF(MemDepUnit, "No dependency for inst PC "
                "%s [sn:%lli].\n", inst->pcState(), inst->seqNum);

        assert(inst_entry->memDeps == 0);

        // 直接标记这个依赖检查完了
        /**
        void
        IssueQue::markMemDepDone(const DynInstPtr& inst)
        {
            assert(inst->isMemRef());
            inst->setMemDepDone();
            addIfReady(inst);*/
        // Add this instruction to the list of dependents.
        // 对于当前还有依赖尚未满足的指令
        // 将依赖的信息保存到 entry 中
        for (auto store_entry : store_entries)
            store_entry->dependInsts.push_back(inst_entry);

        // 记录还需要满足依赖或者顺序的数目
        inst_entry->memDeps = store_entries.size();

        if (inst->isLoad()) {
            // 更新统计变量
            ++stats.conflictingLoads;
        } else {
            ++stats.conflictingStores;
        }
    }

    // for load-acquire store-release that could also be a barrier
    // 如果当前指令是 barrier，将其插入到屏障中
    insertBarrierSN(inst);

    if (inst->isStore() || inst->isAtomic()) {
        DPRINTF(MemDepUnit, "Inserting store/atomic PC %s [sn:%lli].\n",
                inst->pcState(), inst->seqNum);
        // 对于 store 指令，向内存依赖预测单元中插入
        // 插入到 store set 中
        depPred.insertStore(inst->pcState().instAddr(), inst->seqNum,
                inst->threadNumber, cpu->curCycle());

        ++stats.insertedStores;
    } else if (inst->isLoad()) {
        ++stats.insertedLoads;
    } else {
        panic("Unknown type! (most likely a barrier).");
    }
}

```

这以上都还是进入到保留站时候发生的事，主要还是在保留站之前进行 store 依赖/barrier 顺序 的检查，在满足之后，就能够发射执行了。

### 执行阶段

执行阶段的代码为：

```cpp
else if (inst->isLoad()) {
    // Loads will mark themselves as executed, and their writeback
    // event adds the instruction to the queue to commit
    fault = ldstQueue.executeLoad(inst);

    if (inst->isTranslationDelayed() && fault == NoFault) {
        // A hw page table walk is currently going on; the
        // instruction must be deferred.
        DPRINTF(IEW,
                "Execute: Delayed translation, deferring "
                "load.\n");
        // 推迟 meminst
        // 推迟之后会被重新建模发射延时
        instQueue.deferMemInst(inst);
        continue;
    }

    if (inst->isDataPrefetch() || inst->isInstPrefetch()) {
        inst->fault = NoFault;
    }
} 
```

首先调用的是 lsq 的 execute load:

```cpp
Fault
LSQUnit::executeLoad(const DynInstPtr &inst)
{
    // Execute a specific load.
    Fault load_fault = NoFault;

    DPRINTF(LSQUnit, "Executing load PC %s, [sn:%lli]\n", inst->pcState(), inst->seqNum);

    assert(!inst->isSquashed());

    // 执行 load 的 init acc 操作
    /*
        inst->initiateAcc =>
        memhelper->initiatememacc =>
        dyn_inst->initmemread =>
        o3cpu -> pushRequest =>
        iew.lsq.pushRequest
    */
    // 地址翻译 -> 地址翻译成功的直接产生访问具体的访问请求
    // 如果想要的数据在 store buffer 里，在本周期就能直接前递
    load_fault = inst->initiateAcc();

    if (!inst->translationCompleted()) {
        // 如果 TLB 翻译没有完成
        // 就取消掉某条 load
        // 由于投机调度的原因
        // 源寄存器是这个load的也要被取消
        iewStage->loadCancel(inst);
    } else {
        DPRINTF(LSQUnit, "load tlb hit [sn:%lli]\n", inst->seqNum);
    }

    if (load_fault == NoFault && !inst->readMemAccPredicate()) {
        // 对于没毛病且不需要读内存的，直接完成
        assert(inst->readPredicate());
        inst->setExecuted();
        warn("packet is nullptr");
        inst->completeAcc(nullptr);
        iewStage->instToCommit(inst);
        iewStage->activityThisCycle();
        return NoFault;
    }

    // 由于地址翻译推迟的直接返回
    if (inst->isTranslationDelayed() && load_fault == NoFault) {
        return load_fault;
    }

    // 对于 split 中部分有毛病的当没毛病返回
    if (load_fault != NoFault && inst->translationCompleted() && inst->savedRequest->isPartialFault() &&
        !inst->savedRequest->isComplete()) {
        assert(inst->savedRequest->isSplit());
        // If we have a partial fault where the mem access is not complete yet
        // then the cache must have been blocked. This load will be re-executed
        // when the cache gets unblocked. We will handle the fault when the
        // mem access is complete.
        return NoFault;
    }

    // If the instruction faulted or predicated false, then we need to send it
    // along to commit without the instruction completing.
    // 产生异常的或是不需要计算的，直接 commit 就行
    if (load_fault != NoFault || !inst->readPredicate()) {
        // Send this instruction to commit, also make sure iew stage
        // realizes there is activity.  Mark it as executed unless it
        // is a strictly ordered load that needs to hit the head of
        // commit.
        // 直接前递寄存器
        // 这个情况在 risc-v 下应该不出现
        if (!inst->readPredicate())
            inst->forwardOldRegs();
        DPRINTF(LSQUnit, "Load [sn:%lli] not executed from %s\n", inst->seqNum,
                (load_fault != NoFault ? /*"fault"*/ load_fault->name() : "predication"));
        if (!(inst->hasRequest() && inst->strictlyOrdered()) || inst->isAtCommit()) {
            // 符合上面情况的设置已经被执行
            inst->setExecuted();
        }
        iewStage->instToCommit(inst);
        iewStage->activityThisCycle();
    } else {
        if (inst->effAddrValid()) {
            auto it = inst->lqIt;
            ++it;

            if (checkLoads)
                // 对于 load 他好像在进行外部的检查
                // 在单核情况下应该不用考虑 感觉得 assert 掉
                return checkViolations(it, inst);
        }
    }

    // 返回 fault
    return load_fault;
}

```

上面 initacc 部分调用的实际是 lsq的pushrequest，先对其做相关的解析：

---

```cpp
Fault
LSQ::pushRequest(const DynInstPtr& inst, bool isLoad, uint8_t *data,
        unsigned int size, Addr addr, Request::Flags flags, uint64_t *res,
        AtomicOpFunctorPtr amo_op, const std::vector<bool>& byte_enable)
{
    // This comming request can be either load, store or atomic.
    // Atomic request has a corresponding pointer to its atomic memory
    // operation
    // store 加含有 amo op 的就是原子指令
    [[maybe_unused]] bool isAtomic = !isLoad && amo_op;

    // 拿到线程 id
    ThreadID tid = cpu->contextToThread(inst->contextId());
    auto cacheLineSize = cpu->cacheLineSize();
    // burst 翻译过来是突发访问
    // 启示这里强调的是数据到底是分布在一个 cache line 中还是多个 cache line 中
    // 如果位于多个 cache line 那就回返回 true
    bool needs_burst = transferNeedsBurst(addr, size, cacheLineSize);
    LSQRequest* request = nullptr;

    // Atomic requests that access data across cache line boundary are
    // currently not allowed since the cache does not guarantee corresponding
    // atomic memory operations to be executed atomically across a cache line.
    // For ISAs such as x86 that supports cross-cache-line atomic instructions,
    // the cache needs to be modified to perform atomic update to both cache
    // lines. For now, such cross-line update is not supported.
    // 原子指令不能跨页
    assert(!isAtomic || (isAtomic && !needs_burst));

    // 检查这些包属于哪种类型的内存包
    const bool htm_cmd = isLoad && (flags & Request::HTM_CMD);
    const bool tlbi_cmd = isLoad && (flags & Request::TLBI_CMD);

    //如果这是一个已经开始的事务
    if (inst->translationStarted()) {
        // request 从原先的请求中拿
        request = inst->savedRequest;
        assert(request);
    } else {
        // 不同的类型产生不同的 request
        if (htm_cmd || tlbi_cmd) {
            assert(addr == 0x0lu);
            assert(size == 8);
            // 硬件事务内存或者 itlb 相关的内存访问
            request = new UnsquashableDirectRequest(&thread[tid], inst, flags);
        } else if (needs_burst) {
            request = new SplitDataRequest(&thread[tid], inst, isLoad, addr, size, flags, data, res);
        } else {
            request = new SingleDataRequest(&thread[tid], inst, isLoad, addr, size, flags, data, res,
                                            std::move(amo_op));
        }
        assert(request);
        // byteenable 就是类似的谓词机制
        request->_byteEnable = byte_enable;
        // 设置当前 inst 已经产生了一个 request 包
        inst->setRequest();
        // 给 request 设置 id
        request->taskId(cpu->taskId());

        // There might be fault from a previous execution attempt if this is
        // a strictly ordered load
        // 执行到此还没有意外发生
        inst->getFault() = NoFault;

        // 开始内存事务，不同类型的 request 有不同的内存事务
        request->initiateTranslation();
    }

    /* This is the place were instructions get the effAddr. */
    // 如果创建的事务完成
    // 上面的 initiateTranslation 非常复杂
    // isTranslationComplete 代表地址翻译的完成
    // 接下来应该要正式发送请求了
    if (request->isTranslationComplete()) {
        if (request->isMemAccessRequired()) {
            // 设置访问用的相关参数
            inst->effAddr = request->getVaddr();
            inst->effSize = size;
            inst->effAddrValid(true);

            if (cpu->checker) {
                inst->reqToVerify = std::make_shared<Request>(*request->req());
            }
            Fault fault;
            if (isLoad)
                // lsq unit read
                fault = read(request, inst->lqIdx);
            else
                // lsq unit write
                fault = write(request, data, inst->sqIdx);
            // inst->getFault() may have the first-fault of a
            // multi-access split request at this point.
            // Overwrite that only if we got another type of fault
            // (e.g. re-exec).
            if (fault != NoFault)
                // 上面的 read 会处理访问过程中的异常
                // 对于上面过程中遇到的异常进行设置
                inst->getFault() = fault;
        } else if (isLoad) {
            // 不需要内存访问的设置相关的标记
            // 注意这里跟那个 readpredicate 不是一个东西
            inst->setMemAccPredicate(false);
            // Commit will have to clean up whatever happened.  Set this
            // instruction as executed.
            inst->setExecuted();
        }
    }

    if (inst->traceData)
        inst->traceData->setMem(addr, size, flags);

    // 返回这个过程中出现的错误
    return inst->getFault();
}
```

这里全部还只是 initacc 的过程，还是没有包括 TLB 翻译还有 lsq unit read 的，这两个放到后续记录。

read 相关的代码如下：

```cpp
Fault
LSQUnit::read(LSQRequest *request, ssize_t load_idx)
{
    // 注意现代是已经完成了虚拟地址到物理地址的转换了
    LQEntry &load_entry = loadQueue[load_idx];
    const DynInstPtr &load_inst = load_entry.instruction();

    DPRINTF(LSQUnit, "request: size: %u, Addr: %#lx\n", request->mainReq()->getSize(), request->mainReq()->getVaddr());

    Addr addr = request->mainReq()->getVaddr();
    Addr size = request->mainReq()->getSize();
    bool cross16Byte = (addr % 16) + size > 16;
    if (load_inst->isVector() && cross16Byte) {
        if (load_inst->opClass() == enums::VectorUnitStrideLoad) {
            stats.unitStrideCross16Byte++;
        } else {
            stats.nonUnitStrideCross16Byte++;
        }
    }
    if (load_inst->isVector() && !cross16Byte) {
        if (load_inst->opClass() == enums::VectorUnitStrideLoad) {
            stats.unitStrideAligned++;
        }
    }

    // 触发非对齐的内存访问的异常
    if (!load_inst->isVector() && request->mainReq()->getSize() > 1 &&
        request->mainReq()->getVaddr() % request->mainReq()->getSize() != 0) {
        DPRINTF(LSQUnit, "request: size: %u, Addr: %#lx, code: %d\n", request->mainReq()->getSize(),
                request->mainReq()->getVaddr(), RiscvISA::ExceptionCode::LOAD_ADDR_MISALIGNED);
        return std::make_shared<RiscvISA::AddressFault>(request->mainReq()->getVaddr(),
                                                        RiscvISA::ExceptionCode::LOAD_ADDR_MISALIGNED);
    }

    // 将 request 放置到 entry 中
    load_entry.setRequest(request);
    assert(load_inst);

    assert(!load_inst->isExecuted());

    // Make sure this isn't a strictly ordered load
    // A bit of a hackish way to get strictly ordered accesses to work
    // only if they're at the head of the LSQ and are ready to commit
    // (at the head of the ROB too).
    // 这里是 mmio 的情况
    // mmio 一定是序严格的，在执行的时候其一定已经位于队列的头部
    // 一定要保证严格顺序的访问 这个顺序无法恢复 说明序没有维护好
    if (request->mainReq()->isStrictlyOrdered() && (load_idx != loadQueue.head() || !load_inst->isAtCommit())) {
        // should not enter this
        // Tell IQ/mem dep unit that this instruction will need to be
        // rescheduled eventually
        iewStage->rescheduleMemInst(load_inst);
        load_inst->effAddrValid(false);
        ++stats.rescheduledLoads;
        DPRINTF(LSQUnit, "Strictly ordered load [sn:%lli] PC %s\n", load_inst->seqNum, load_inst->pcState());

        // Must delete request now that it wasn't handed off to
        // memory.  This is quite ugly.  @todo: Figure out the proper
        // place to really handle request deletes.
        load_entry.setRequest(nullptr);
        request->discard();
        return std::make_shared<GenericISA::M5PanicFault>("Strictly ordered load [sn:%lli] PC %s\n", load_inst->seqNum,
                                                          load_inst->pcState());
    }

    DPRINTF(LSQUnit,
            "Read called, load idx: %i, store idx: %i, "
            "storeHead: %i addr: %#x%s\n",
            load_idx - 1, load_inst->sqIt._idx, storeQueue.head() - 1, request->mainReq()->getPaddr(),
            request->isSplit() ? " split" : "");

    if (squashMark) {
        // 不明含义
        request->mainReq()->setFirstReqAfterSquash();
        squashMark = false;
    }

    // 像是记录了地址 为 LL SC 提供了某种支持
    // RISC-V 下没有特别的操作
    if (request->mainReq()->isLLSC()) {
        // Disable recording the result temporarily.  Writing to misc
        // regs normally updates the result, but this is not the
        // desired behavior when handling store conditionals.
        load_inst->recordResult(false);
        load_inst->tcBase()->getIsaPtr()->handleLockedRead(load_inst.get(), request->mainReq());
        load_inst->recordResult(true);
    }

    // 某种本地访问请求 基本上没用到
    if (request->mainReq()->isLocalAccess()) {
        assert(!load_inst->memData);
        load_inst->memData = new uint8_t[MaxDataBytes];

        gem5::ThreadContext *thread = cpu->tcBase(lsqID);
        PacketPtr main_pkt = new Packet(request->mainReq(), MemCmd::ReadReq);

        main_pkt->dataStatic(load_inst->memData);

        Cycles delay = request->mainReq()->localAccessor(thread, main_pkt);

        WritebackEvent *wb = new WritebackEvent(load_inst, main_pkt, this);
        cpu->schedule(wb, cpu->clockEdge(delay));
        return NoFault;
    }

    // 下面是检查 store 到 load 的前递
    // Check the SQ for any previous stores that might lead to forwarding
    auto store_it = load_inst->sqIt;
    assert(store_it >= storeWBIt);
    // End once we've reached the top of the LSQ
    while (store_it != storeWBIt && !load_inst->isDataPrefetch()) {
        // Move the index to one younger
        store_it--;
        assert(store_it->valid());
        assert(store_it->instruction()->seqNum < load_inst->seqNum);
        int store_size = store_it->size();

        // Cache maintenance instructions go down via the store
        // path but they carry no data and they shouldn't be
        // considered for forwarding
        if (store_size != 0 && !store_it->instruction()->strictlyOrdered() &&
            !(store_it->request()->mainReq() && store_it->request()->mainReq()->isCacheMaintenance())) {
            assert(store_it->instruction()->effAddrValid());

            // Check if the store data is within the lower and upper bounds of
            // addresses that the request needs.
            auto req_s = request->mainReq()->getVaddr();
            auto req_e = req_s + request->mainReq()->getSize();
            auto st_s = store_it->instruction()->effAddr;
            auto st_e = st_s + store_size;

            bool store_has_lower_limit = req_s >= st_s;
            bool store_has_upper_limit = req_e <= st_e;
            bool lower_load_has_store_part = req_s < st_e;
            bool upper_load_has_store_part = req_e > st_s;

            DPRINTF(LSQUnit, "req_s:%x,req_e:%x,st_s:%x,st_e:%x\n", req_s, req_e, st_s, st_e);
            DPRINTF(LSQUnit, "store_size:%x,store_pc:%s,req_size:%x,req_pc:%s\n", store_size,
                    store_it->instruction()->pcState(), request->mainReq()->getSize(),
                    request->instruction()->pcState());

            auto coverage = AddrRangeCoverage::NoAddrRangeCoverage;

            // If the store entry is not atomic (atomic does not have valid
            // data), the store has all of the data needed, and
            // the load is not LLSC, then
            // we can forward data from the store to the load
            if ((!store_it->instruction()->isAtomic() && store_has_lower_limit && store_has_upper_limit &&
                 !request->mainReq()->isLLSC()) &&
                (!((req_s > req_e) || (st_s > st_e)))) {
                const auto &store_req = store_it->request()->mainReq();
                coverage = store_req->isMasked() ? AddrRangeCoverage::PartialAddrRangeCoverage
                                                 : AddrRangeCoverage::FullAddrRangeCoverage;
            } else if ((!((req_s > req_e) || (st_s > st_e))) &&
                       (
                           // This is the partial store-load forwarding case
                           // where a store has only part of the load's data
                           // and the load isn't LLSC
                           (!request->mainReq()->isLLSC() &&
                            ((store_has_lower_limit && lower_load_has_store_part) ||
                             (store_has_upper_limit && upper_load_has_store_part) ||
                             (lower_load_has_store_part && upper_load_has_store_part))) ||
                           // The load is LLSC, and the store has all or part
                           // of the load's data
                           (request->mainReq()->isLLSC() && ((store_has_lower_limit || upper_load_has_store_part) &&
                                                             (store_has_upper_limit || lower_load_has_store_part))) ||
                           // The store entry is atomic and has all or part of
                           // the load's data
                           (store_it->instruction()->isAtomic() &&
                            ((store_has_lower_limit || upper_load_has_store_part) &&
                             (store_has_upper_limit || lower_load_has_store_part))))) {

                coverage = AddrRangeCoverage::PartialAddrRangeCoverage;
            }

            if (coverage == AddrRangeCoverage::FullAddrRangeCoverage) {
                // Get shift amount for offset into the store's data.
                int shift_amt = request->mainReq()->getVaddr() - store_it->instruction()->effAddr;

                // Allocate memory if this is the first time a load is issued.
                if (!load_inst->memData) {
                    load_inst->memData = new uint8_t[request->mainReq()->getSize()];
                }
                if (store_it->isAllZeros())
                    memset(load_inst->memData, 0, request->mainReq()->getSize());
                else {
                    memcpy(load_inst->memData, store_it->data() + shift_amt, request->mainReq()->getSize());
                }

                DPRINTF(LSQUnit,
                        "Forwarding from store idx %i to load to "
                        "addr %#x\n",
                        store_it._idx, request->mainReq()->getVaddr());

                PacketPtr data_pkt = new Packet(request->mainReq(), MemCmd::ReadReq);
                data_pkt->dataStatic(load_inst->memData);

                // hardware transactional memory
                // Store to load forwarding within a transaction
                // This should be okay because the store will be sent to
                // the memory subsystem and subsequently get added to the
                // write set of the transaction. The write set has a stronger
                // property than the read set, so the load doesn't necessarily
                // have to be there.
                assert(!request->mainReq()->isHTMCmd());
                if (load_inst->inHtmTransactionalState()) {
                    assert(!storeQueue[store_it._idx].completed());
                    assert(storeQueue[store_it._idx].instruction()->inHtmTransactionalState());
                    assert(load_inst->getHtmTransactionUid() ==
                           storeQueue[store_it._idx].instruction()->getHtmTransactionUid());
                    data_pkt->setHtmTransactional(load_inst->getHtmTransactionUid());
                    DPRINTF(HtmCpu,
                            "HTM LD (ST2LDF) "
                            "pc=0x%lx - vaddr=0x%lx - "
                            "paddr=0x%lx - htmUid=%u\n",
                            load_inst->pcState().instAddr(),
                            data_pkt->req->hasVaddr() ? data_pkt->req->getVaddr() : 0lu, data_pkt->getAddr(),
                            load_inst->getHtmTransactionUid());
                }

                if (request->isAnyOutstandingRequest()) {
                    assert(request->_numOutstandingPackets > 0);
                    // There are memory requests packets in flight already.
                    // This may happen if the store was not complete the
                    // first time this load got executed. Signal the senderSate
                    // that response packets should be discarded.
                    request->discard();
                }

                WritebackEvent *wb = new WritebackEvent(load_inst, data_pkt, this);

                // We'll say this has a 1 cycle load-store forwarding latency
                // for now.
                // @todo: Need to make this a parameter.
                cpu->schedule(wb, curTick());

                // Don't need to do anything special for split loads.
                ++stats.forwLoads;

                return NoFault;
            } else if (coverage == AddrRangeCoverage::PartialAddrRangeCoverage) {
                // If it's already been written back, then don't worry about
                // stalling on it.
                if (store_it->completed()) {
                    panic("Should not check one of these");
                    continue;
                }

                // Must stall load and force it to retry, so long as it's the
                // oldest load that needs to do so.
                if (!stalled || (stalled && load_inst->seqNum < loadQueue[stallingLoadIdx].instruction()->seqNum)) {
                    stalled = true;
                    stallingStoreIsn = store_it->instruction()->seqNum;
                    stallingLoadIdx = load_idx;
                }

                // Tell IQ/mem dep unit that this instruction will need to be
                // rescheduled eventually
                // 暂时不明确 像是要在合适的时机重来
                iewStage->rescheduleMemInst(load_inst);
                load_inst->effAddrValid(false);
                ++stats.rescheduledLoads;

                // Do not generate a writeback event as this instruction is not
                // complete.
                DPRINTF(LSQUnit,
                        "Load-store forwarding mis-match. "
                        "Store idx %i to load addr %#x\n",
                        store_it._idx, request->mainReq()->getVaddr());

                // Must discard the request.
                request->discard();
                load_entry.setRequest(nullptr);
                return NoFault;
            }
        }
    }

    // If there's no forwarding case, then go access memory
    DPRINTF(LSQUnit, "Doing memory access for inst [sn:%lli] PC %s\n", load_inst->seqNum, load_inst->pcState());

    // Allocate memory if this is the first time a load is issued.
    // 第一次为需要访问的数据分配存储空间
    if (!load_inst->memData) {
        load_inst->memData = new uint8_t[request->mainReq()->getSize()];
    }


    // hardware transactional memory
    if (request->mainReq()->isHTMCmd()) {
        // this is a simple sanity check
        // the Ruby cache controller will set
        // memData to 0x0ul if successful.
        *load_inst->memData = (uint64_t)0x1ull;
    }

    // For now, load throughput is constrained by the number of
    // load FUs only, and loads do not consume a cache port (only
    // stores do).
    // @todo We should account for cache port contention
    // and arbitrate between loads and stores.

    // if we the cache is not blocked, do cache access
    request->buildPackets();
    // 没发出去要取消重来
    if (!request->sendPacketToCache()) {
        iewStage->loadCancel(load_inst);
    }
    // 可能也是上面类似的情况
    if (!request->isSent()) {
        iewStage->blockMemInst(load_inst);
    }

    return NoFault;
}

```

---

### commit 阶段

对于 load 来说, commit 阶段就是很常规的行为。

## store

这里只是简单的指 store 指令，但是原子或者sc等等也会被放到 store 里面，单独列出来，这里不管。

### 指派、准备发射阶段

在这个阶段的流程和 load 是一样的,其调用的是 lsq 的 insert store，过程是一模一样的。其依赖的分析也是和 load 一样走的相同的过程，只不过作为load 他在依赖分析的时候还会插入到 storeset 中。

### 执行阶段

在执行阶段进行 executeStore 的执行，注意到了执行的时候，地址的解析都是已经完成了的。

```cpp
Fault
LSQUnit::executeStore(const DynInstPtr &store_inst)
{
    // Make sure that a store exists.
    assert(storeQueue.size() != 0);

    ssize_t store_idx = store_inst->sqIdx;

    DPRINTF(LSQUnit, "Executing store PC %s [sn:%lli]\n", store_inst->pcState(), store_inst->seqNum);

    assert(!store_inst->isSquashed());

    // Check the recently completed loads to see if any match this store's
    // address.  If so, then we have a memory ordering violation.
    typename LoadQueue::iterator loadIt = store_inst->lqIt;

    // 实际上调用的也是 pushrequest
    // 简单的理解这个地方就是进行了地址转换然后发起了访问
    Fault store_fault = store_inst->initiateAcc();

    // TLB 地址转换带来的推迟
    if (store_inst->isTranslationDelayed() && store_fault == NoFault)
        return store_fault;

    // 基本不会出现这种情况
    if (!store_inst->readPredicate()) {
        DPRINTF(LSQUnit, "Store [sn:%lli] not executed from predication\n", store_inst->seqNum);
        store_inst->forwardOldRegs();
        return store_fault;
    }

    // 压根就不用 store 的情况
    // 咱不明确
    if (storeQueue[store_idx].size() == 0) {
        DPRINTF(LSQUnit, "Fault on Store PC %s, [sn:%lli], Size = 0\n", store_inst->pcState(), store_inst->seqNum);

        if (store_inst->isAtomic()) {
            // If the instruction faulted, then we need to send it along
            // to commit without the instruction completing.
            if (!(store_inst->hasRequest() && store_inst->strictlyOrdered()) || store_inst->isAtCommit()) {
                store_inst->setExecuted();
            }
            iewStage->instToCommit(store_inst);
            iewStage->activityThisCycle();
        }

        return store_fault;
    }

    assert(store_fault == NoFault);

    // SC
    if (store_inst->isStoreConditional() || store_inst->isAtomic()) {
        // Store conditionals and Atomics need to set themselves as able to
        // writeback if we haven't had a fault by here.
        storeQueue[store_idx].canWB() = true;

        ++storesToWB;
    } else {
        if (enableStorePrefetchTrain) {
            triggerStorePFTrain(store_idx);
        }
    }

    // 内存依赖分析检查
    return checkViolations(loadIt, store_inst);
}

```

最为关键的是最后的内存依赖的分析部分。

```cpp
Fault
LSQUnit::checkViolations(typename LoadQueue::iterator &loadIt, const DynInstPtr &inst)
{
    // inst 在多核情况下可能是来自其他核的 load 等等，这里不考虑多核
    // 因此认为这里的 inst 是一条 store 指令
    // 计算出 store 的起始和结束地址
    Addr inst_eff_addr1 = inst->effAddr >> depCheckShift;
    Addr inst_eff_addr2 = (inst->effAddr + inst->effSize - 1) >> depCheckShift;

    /** @todo in theory you only need to check an instruction that has executed
     * however, there isn't a good way in the pipeline at the moment to check
     * all instructions that will execute before the store writes back. Thus,
     * like the implementation that came before it, we're overly conservative.
     */
    DPRINTF(LSQUnit, "Checking for violations for store [sn:%lli], addr: %#lx\n", inst->seqNum, inst->effAddr);
    while (loadIt != loadQueue.end()) {
        // 检查在这条 steore 指派之后所有指派的 load
        DynInstPtr ld_inst = loadIt->instruction();
        if (!ld_inst->effAddrValid() || ld_inst->strictlyOrdered()) {
            ++loadIt;
            continue;
        }

        // 计算出 load 的起始地址和结束地址
        Addr ld_eff_addr1 = ld_inst->effAddr >> depCheckShift;
        Addr ld_eff_addr2 = (ld_inst->effAddr + ld_inst->effSize - 1) >> depCheckShift;

        DPRINTF(LSQUnit, "Checking for violations for load [sn:%lli], addr: %#lx\n", ld_inst->seqNum,
                ld_inst->effAddr);
        // 如果 load 的地址和 store 的地址产生了交集
        if (inst_eff_addr2 >= ld_eff_addr1 && inst_eff_addr1 <= ld_eff_addr2) {
            if (inst->isLoad()) {
                // 不考虑多核的情况
                // If this load is to the same block as an external snoop
                // invalidate that we've observed then the load needs to be
                // squashed as it could have newer data
                if (ld_inst->hitExternalSnoop()) {
                    if (!memDepViolator || ld_inst->seqNum < memDepViolator->seqNum) {
                        DPRINTF(LSQUnit,
                                "Detected fault with inst [sn:%lli] "
                                "and [sn:%lli] at address %#x\n",
                                inst->seqNum, ld_inst->seqNum, ld_eff_addr1);
                        memDepViolator = ld_inst;

                        ++stats.memOrderViolation;

                        return std::make_shared<GenericISA::M5PanicFault>(
                            "Detected fault with inst [sn:%lli] and "
                            "[sn:%lli] at address %#x\n",
                            inst->seqNum, ld_inst->seqNum, ld_eff_addr1);
                    }
                }

                // Otherwise, mark the load has a possible load violation and
                // if we see a snoop before it's commited, we need to squash
                ld_inst->possibleLoadViolation(true);
                DPRINTF(LSQUnit,
                        "Found possible load violation at addr: %#x"
                        " between instructions [sn:%lli] and [sn:%lli]\n",
                        inst_eff_addr1, inst->seqNum, ld_inst->seqNum);
            } else {
                // A load/store incorrectly passed this store.
                // Check if we already have a violator, or if it's newer
                // squash and refetch.
                // 如果已经找到了一个违反者，这这个违反者的年龄比当前遍历的这个 load 老
                // 就可以停止了
                // 要找的是最老的那个违反者
                if (memDepViolator && ld_inst->seqNum > memDepViolator->seqNum)
                    break;

                DPRINTF(LSQUnit,
                        "ld_eff_addr1: %#x, ld_eff_addr2: %#x, "
                        "inst_eff_addr1: %#x, inst_eff_addr2: %#x\n",
                        ld_eff_addr1, ld_eff_addr2, inst_eff_addr1, inst_eff_addr2);
                DPRINTF(LSQUnit,
                        "Detected fault with inst [sn:%lli] and "
                        "[sn:%lli] at address %#x\n",
                        inst->seqNum, ld_inst->seqNum, ld_eff_addr1);

                // 将违反者设置成这个地址冲突的 load
                memDepViolator = ld_inst;

                // 修改统计计数
                ++stats.memOrderViolation;

                // !这里看似返回了一个 panic fault，但是实际上这个 fault 没有被放到指令中
                // 是不会在 commit 阶段被 invoke 的
                return std::make_shared<GenericISA::M5PanicFault>(
                    "Detected fault with "
                    "inst [sn:%lli] and [sn:%lli] at address %#x\n",
                    inst->seqNum, ld_inst->seqNum, ld_eff_addr1);
            }
        }

        ++loadIt;
    }
    return NoFault;
}

```

在 execute 执行的时候，不仅对于内存访问被发起了，同时也检查出了内存顺序的违反。在 executeStore 执行之后，紧接着就进行了是否需要清空的判断。

```cpp
if (!fetchRedirect[tid] || !execWB->squash[tid] || execWB->squashedSeqNum[tid] > inst->seqNum) {

    // Prevent testing for misprediction on load instructions,
    // that have not been executed.
    bool loadNotExecuted = !inst->isExecuted() && inst->isLoad();

    if (inst->mispredicted() && !loadNotExecuted) {
        // mispredict squash
    } else if (ldstQueue.violation(tid)) {
        assert(inst->isMemRef());
        // If there was an ordering violation, then get the
        // DynInst that caused the violation.  Note that this
        // clears the violation signal.
        DynInstPtr violator;
        // 拿到顺序违反的指令
        violator = ldstQueue.getMemDepViolator(tid);

        DPRINTF(IEW,
                "LDSTQ detected a violation. Violator PC: %s "
                "[sn:%lli], inst PC: %s [sn:%lli]. Addr is: %#x.\n",
                violator->pcState(), violator->seqNum, inst->pcState(), inst->seqNum, inst->physEffAddr);

        fetchRedirect[tid] = true;

        // Tell the instruction queue that a violation has occured.
        // 这里实际上是在训练 storeset
        instQueue.violation(inst, violator);

        // Squash.
        // 向后发出清空信号
        squashDueToMemOrder(violator, tid);

        ++iewStats.memOrderViolationEvents;
    }
} else {
    // 已经有更老的内存违反指令了
    // 不需要再处理这个新的
    if (ldstQueue.violation(tid)) {
        assert(inst->isMemRef());

        DynInstPtr violator = ldstQueue.getMemDepViolator(tid);

        DPRINTF(IEW,
                "LDSTQ detected a violation.  Violator PC: "
                "%s, inst PC: %s.  Addr is: %#x.\n",
                violator->pcState(), inst->pcState(), inst->physEffAddr);
        DPRINTF(IEW,
                "Violation will not be handled because "
                "already squashing\n");

        ++iewStats.memOrderViolationEvents;
    }
}

```

### commit 阶段

正常提交。

## no spec

### 指派阶段

会调用特殊的 insertBarrierSN 函数，会根据这个指令是 load 还是 store 类型插入屏障，仅此而已。

### 提交阶段

参考[这篇文章](../../gem5src/cpu/o3/commit.md)，提交阶段满足了 nospec 的要求之后，才能能够进行 nospec 的调度。

### 调度

```cpp
if (fromCommit->commitInfo[tid].nonSpecSeqNum != 0) {

    // DPRINTF(IEW,"NonspecInst from thread %i",tid);
    // strictlyOrdered 和 no-spec 都代表了一种排序
    // 因此同一时间选取一个执行
    // 因为 commit 是顺序的，所以最早的那个肯定会先在这里被执行
    if (fromCommit->commitInfo[tid].strictlyOrdered) {
        instQueue.replayMemInst(fromCommit->commitInfo[tid].strictlyOrderedLoad);
        fromCommit->commitInfo[tid].strictlyOrderedLoad->setAtCommit();
    } else {
        instQueue.scheduleNonSpec(fromCommit->commitInfo[tid].nonSpecSeqNum);
    }
}
```

直到接收了 commit 阶段的信号之后，在符合条件的情况下才进行了 schedule nospec 的操作。

```cpp
void
InstructionQueue::scheduleNonSpec(const InstSeqNum &inst)
{
    DPRINTF(IQ,
            "Marking nonspeculative instruction [sn:%llu] as ready "
            "to execute.\n",
            inst);

    NonSpecMapIt inst_it = nonSpecInsts.find(inst);

    assert(inst_it != nonSpecInsts.end());

    ThreadID tid = (*inst_it).second->threadNumber;

    (*inst_it).second->setAtCommit();
    (*inst_it).second->setCanIssue();

    scheduler->addToFU((*inst_it).second);

    (*inst_it).second = NULL;

    nonSpecInsts.erase(inst_it);
}
```

这部分简单的来讲就是把指令塞到调度队列里面开始调度。

## store buffer

store buffer 会给 load 提供 store-load forward 的 value，貌似是通过虚拟地址和物理地址都能进行前递。但是看到实现中还是在过了 mmu/tlb 之后才根据虚拟地址进行前递。为什么还是要过个 mmu/tlb 翻译过程呢，个人感觉可能是访问的虚拟内存地址可能代表i/o等其他特殊的地址，导致不经过翻译无法确定这部分的属性，所以还是在过了 mmu 之后再进行 forward 的相关处理。

## 访存单元太复杂，感觉还有点不清楚


