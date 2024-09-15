# 访存相关

访存相关主要包括 LSQ 和 LSQ Unit，LSQ 基本在委托 LSQ Unit。目前 riscv 中还是没有硬件事务内存的支持的，暂时不考虑硬件事务内存相关的。

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
            addIfReady(inst);insertLoad
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
                // 进行内存依赖性的检查比较复杂
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
    // todo: 解释含义
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

这里全部还只是 initacc 的过程，还是没有包括 TLB 翻译还有 lsq unit read 的，这两个放到后续记录
---
