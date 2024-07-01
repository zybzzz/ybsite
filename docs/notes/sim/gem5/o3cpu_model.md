# O3CPU model

这篇文章主要是 o3cpu 的杂记，o3cpu 太过复杂，因此只挑一部分对我有用的进行记录。

## IEW 阶段

IEW 阶段主要分为发射、执行、写回三个阶段，在这个大阶段内，实际上还是细分了流水，将发射和执行写回分成了两个不同的阶段，并且这两个阶段之间是可以设置延迟的。IEW的核心逻辑实现在 `tick` 函数中。直接贴上 `tick` 部分的核心代码来进行分析：

```cpp
void
IEW::tick()
{
    wbNumInst = 0;
    wbCycle = 0;

    wroteToTimeBuffer = false;
    updatedQueues = false;
    // 执行ldstQueue
    ldstQueue.tick();

    // 将前一阶段得到的指令按照线程号分散到insts中
    // std::queue<DynInstPtr> insts[MaxThreads];
    // 上面是 insts 的定义，实际上就是根据指令号分散到各个队列中
    sortInsts();

    // 释放掉资源池中能够释放的单元
    fuPool->processFreeUnits();

    std::list<ThreadID>::iterator threads = activeThreads->begin();
    std::list<ThreadID>::iterator end = activeThreads->end();

    // 对于各个硬件线程都进行相关的操作
    while (threads != end) {
        ThreadID tid = *threads++;

        DPRINTF(IEW,"Issue: Processing [tid:%i]\n",tid);

        // 检查相关的信号，并根据信号设置 dispatch 的状态
        checkSignalsAndUpdate(tid); 
        
        // 根据 dispatch 以及后续单元的相关状态进行 dispatch
        // 注意这里的 dispatch 只是将指令插入到后续的队列中
        // 这里的 dispatch 只会进行简单的检查，比如后续的队列能不能放下等
        dispatch(tid);
    }

    if (exeStatus != Squashing) {
        // 执行指令，执行指令只是对指令的结果进行计算，并得到结果
        // 对于整个执行过程的时序建模并不在这个部分进行
        // 这个部分只负责对不同的指令进行计算得到结果
        executeInsts();

        // 将结果写回，如果有指令的寄存器依赖当前的结果，则会唤醒这些寄存器
        // 类似于将结果和前递，写回紧接着执行部分发生
        writebackInsts();

        // 发射相关的指令，这里才有类似于保留站的操作
        // 1. 会检测指令是否依赖满足，然后将其发射
        // 2. 完成指令执行时间的建模，其会向事件队列中插入一个(OpLatency - 1)
        //    的事件，并在时间到之后执行相关的操作，算是对指令执行时序的建模。
        instQueue.scheduleReadyInsts();

        issueToExecQueue.advance();
    }

    bool broadcast_free_entries = false;

    // 更新相关的状态
    if (updatedQueues || exeStatus == Running || updateLSQNextCycle) {
        exeStatus = Idle;
        updateLSQNextCycle = false;

        broadcast_free_entries = true;
    }

    // 处理 store 相关的写回？
    ldstQueue.writebackStores();

    // 根据阶段的状态更新 commit 的相关信息
    // 像前阶段更新一些空闲状态的信息

    threads = activeThreads->begin();
    while (threads != end) {
        ThreadID tid = (*threads++);

        DPRINTF(IEW,"Processing [tid:%i]\n",tid);

        // Update structures based on instructions committed.
        if (fromCommit->commitInfo[tid].doneSeqNum != 0 &&
            !fromCommit->commitInfo[tid].squash &&
            !fromCommit->commitInfo[tid].robSquashing) {

            ldstQueue.commitStores(fromCommit->commitInfo[tid].doneSeqNum,tid);

            ldstQueue.commitLoads(fromCommit->commitInfo[tid].doneSeqNum,tid);

            updateLSQNextCycle = true;
            instQueue.commit(fromCommit->commitInfo[tid].doneSeqNum,tid);
        }

        if (fromCommit->commitInfo[tid].nonSpecSeqNum != 0) {

            //DPRINTF(IEW,"NonspecInst from thread %i",tid);
            if (fromCommit->commitInfo[tid].strictlyOrdered) {
                instQueue.replayMemInst(
                    fromCommit->commitInfo[tid].strictlyOrderedLoad);
                fromCommit->commitInfo[tid].strictlyOrderedLoad->setAtCommit();
            } else {
                instQueue.scheduleNonSpec(
                    fromCommit->commitInfo[tid].nonSpecSeqNum);
            }
        }

        if (broadcast_free_entries) {
            toFetch->iewInfo[tid].iqCount =
                instQueue.getCount(tid);
            toFetch->iewInfo[tid].ldstqCount =
                ldstQueue.getCount(tid);

            toRename->iewInfo[tid].usedIQ = true;
            toRename->iewInfo[tid].freeIQEntries =
                instQueue.numFreeEntries(tid);
            toRename->iewInfo[tid].usedLSQ = true;

            toRename->iewInfo[tid].freeLQEntries =
                ldstQueue.numFreeLoadEntries(tid);
            toRename->iewInfo[tid].freeSQEntries =
                ldstQueue.numFreeStoreEntries(tid);

            wroteToTimeBuffer = true;
        }

        DPRINTF(IEW, "[tid:%i], Dispatch dispatched %i instructions.\n",
                tid, toRename->iewInfo[tid].dispatched);
    }

    DPRINTF(IEW, "IQ has %i free entries (Can schedule: %i).  "
            "LQ has %i free entries. SQ has %i free entries.\n",
            instQueue.numFreeEntries(), instQueue.hasReadyInsts(),
            ldstQueue.numFreeLoadEntries(), ldstQueue.numFreeStoreEntries());

    // 更新 IEW 这个部件的总体状态
    updateStatus();

    // 告诉 cpu 当前阶段我是活动的
    if (wroteToTimeBuffer) {
        DPRINTF(Activity, "Activity this cycle.\n");
        cpu->activityThisCycle();
    }
}
```

## Commit 阶段

### ROB 实现

重排序缓冲的实现可以在[这篇文章](../gem5src/cpu/o3/rob.md)中找到。
