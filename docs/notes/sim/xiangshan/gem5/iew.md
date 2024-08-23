# 香山 iew 阶段

香山 gem5 建模对 gem5 的后端指令调度进行了较大规模的重写。

## 连线和各阶段之间的信息传递

我的主要关注点在 iew 和 commit 阶段的连线上。

对于 iew 阶段有：

```cpp
void
IEW::setIEWQueue(TimeBuffer<IEWStruct> *iq_ptr)
{
    iewQueue = iq_ptr;

    // Setup wire to write instructions to commit.
    toCommit = iewQueue->getWire(0);

    execBypass = iewQueue->getWire(0);
    execWB = iewQueue->getWire(-wbDelay);
}
```

对于 commit 阶段有：

```cpp
void
Commit::setIEWQueue(TimeBuffer<IEWStruct> *iq_ptr)
{
    iewQueue = iq_ptr;

    // Setup wire to get instructions from IEW.
    fromIEW = iewQueue->getWire(-iewToCommitDelay);
}
```

从 python 配置文件中已知的是 wbDelay 和 iewToCommitDelay 的值设置是相同的，默认都是为1.因此实际上 fromIEW 和 execWB 实际上都是指向buffer 中的同一个地方的，如果设置为 1，则是下一个 tick 能够访问到本周期写入的数据。相比之下 toCommit 和 execBypass 就能访问到本周期的一些信息。

## ExecuteInsts

这部分和原来的代码并没有什么不同，我比较关注的点在 instToCommit 这个函数上：

```cpp
void
IEW::instToCommit(const DynInstPtr& inst)
{
    while ((*iewQueue)[wbCycle].insts[wbNumInst]) {
        ++wbNumInst;
        if (wbNumInst == wbWidth) {
            ++wbCycle;
            wbNumInst = 0;
        }
    }

    scheduler->bypassWriteback(inst);
    inst->completionTick = curTick();

    DPRINTF(IEW, "Current wb cycle: %i, width: %i, numInst: %i\nwbActual:%i\n",
            wbCycle, wbWidth, wbNumInst, wbCycle * wbWidth + wbNumInst);
    // Add finished instruction to queue to commit.
    (*iewQueue)[wbCycle].insts[wbNumInst] = inst;
    (*iewQueue)[wbCycle].size++;
}
```

这部分代码做的很关键的事就是在 iew queue 中向 commit 传输一条已经执行完成的指令，受限于每个时钟周期 wbWidth 的影响，代码在控制每个时钟周期向 commit 阶段传送的指令宽度，一旦指令宽度超标了，就会将这个指令的提交向后推迟一个时钟周期，如此往复。对 `(*iewQueue)[wbCycle]` 的访问实际就代表着至少是接下来的 1 个时钟周期之后才能拿到这些指令。

另外一个关键点在于，这里进行了 bypassWriteback，也就是对结果进行相应的前递。

```cpp
void
Scheduler::bypassWriteback(const DynInstPtr& inst)
{
    DPRINTF(Schedule, "[sn %lu] bypass write\n", inst->seqNum);
    for (int i=0; i<inst->numDestRegs(); i++) {
        auto dst = inst->renamedDestIdx(i);
        if (dst->isFixedMapping()) {
            continue;
        }
        bypassScoreboard[dst->flatIndex()] = true;
        DPRINTF(Schedule, "p%lu in bypassNetwork ready\n", dst->flatIndex());
    }
}
```

这个函数内部并没有什么特别的地方，实际上就是修改了用于前递相关的记分牌。

## writebackInsts

```cpp
void
IEW::writebackInsts()
{
    // Loop through the head of the time buffer and wake any
    // dependents.  These instructions are about to write back.  Also
    // mark scoreboard that this instruction is finally complete.
    // Either have IEW have direct access to scoreboard, or have this
    // as part of backwards communication.

    int wb_width = wbWidth;
    int count_ = 0;
    while (execWB->insts[count_]) {
        DynInstPtr it = execWB->insts[count_];
        count_++;
        if (it->opClass() == FMAAccOp) {
            wb_width++;
        }
        if (count_ >= wbWidth ||
            wb_width >= wbWidth * 2) {
            break;
        }
    }

    // 写回的大小只是 wb_width 的大小，一个周期只处理这么多。
    for (int inst_num = 0; inst_num < wb_width &&
             execWB->insts[inst_num]; inst_num++) {
        DynInstPtr inst = execWB->insts[inst_num];
        ThreadID tid = inst->threadNumber;

        if (inst->savedRequest && inst->isLoad()) {
            inst->pf_source = inst->savedRequest->mainReq()->getPFSource();
        }

        DPRINTF(IEW, "Sending instructions to commit, [sn:%lli] PC %s.\n",
                inst->seqNum, inst->pcState());

        iewStats.instsToCommit[tid]++;
        // Notify potential listeners that execution is complete for this
        // instruction.
        ppToCommit->notify(inst);

        // Some instructions will be sent to commit without having
        // executed because they need commit to handle them.
        // E.g. Strictly ordered loads have not actually executed when they
        // are first sent to commit.  Instead commit must tell the LSQ
        // when it's ready to execute the strictly ordered load.
        if (!inst->isSquashed() && inst->isExecuted() &&
                inst->getFault() == NoFault) {

            scheduler->writebackWakeup(inst);
            int dependents = instQueue.wakeDependents(inst);

            for (int i = 0; i < inst->numDestRegs(); i++) {
                // Mark register as ready if not pinned
                if (inst->renamedDestIdx(i)->
                        getNumPinnedWritesToComplete() == 0) {
                    DPRINTF(IEW,"Setting Destination Register %i (%s)\n",
                            inst->renamedDestIdx(i)->index(),
                            inst->renamedDestIdx(i)->className());
                    scoreboard->setReg(inst->renamedDestIdx(i));
                }
            }

            if (dependents) {
                iewStats.producerInst[tid]++;
                iewStats.consumerInst[tid]+= dependents;
            }
            iewStats.writebackCount[tid]++;
        }
    }
}
```

这一步是真实的进行写回，并同时调用了 scheduler 的调度器和 instQueue 的 wakeDependents 方法。

### 调度器的 writebackWakeup

```cpp
void
Scheduler::writebackWakeup(const DynInstPtr& inst)
{
    DPRINTF(Schedule, "[sn %lu] was writeback\n", inst->seqNum);
    inst->issueQue = nullptr;// clear in issueQue
    for (int i = 0; i < inst->numDestRegs(); i++) {
        auto dst = inst->renamedDestIdx(i);
        if (dst->isFixedMapping()) {
            continue;
        }
        scoreboard[dst->flatIndex()] = true;
    }
    for (auto it : issueQues) {
        it->wakeUpDependents(inst, false);
    }
}
```

这部分主要对调度器内部的记分牌进行了设置，同时调用发射队列的唤醒。

```cpp
void
IssueQue::wakeUpDependents(const DynInstPtr& inst, bool speculative)
{
    if (speculative && inst->canceled()) {
        return;
    }
    for (int i = 0; i < inst->numDestRegs(); i++) {
        PhysRegIdPtr dst = inst->renamedDestIdx(i);
        if (dst->isFixedMapping() || dst->getNumPinnedWritesToComplete() != 1) {
            continue;;
        }

        DPRINTF(Schedule, "was %s woken by p%lu [sn %lu]\n",
            speculative ? "spec" : "wb", dst->flatIndex(), inst->seqNum);
        for (auto& it: subDepGraph[dst->flatIndex()]) {
            int srcIdx = it.first;
            auto consumer = it.second;
            if (consumer->readySrcIdx(srcIdx)) {
                continue;
            }
            consumer->markSrcRegReady(srcIdx);

            if (!speculative && consumer->srcRegIdx(srcIdx) == RiscvISA::VecRenamedVLReg) {
                consumer->checkOldVdElim();
            }

            DPRINTF(Schedule, "[sn %lu] src%d was woken\n", consumer->seqNum, srcIdx);
            addIfReady(consumer);
        }

        if (!speculative) {
            subDepGraph[dst->flatIndex()].clear();
        }
    }
}
```

可以看到这一部分和本身 gem5 代码中的写回并没有什么不同，实际上对依赖图进行了分析，确保后续准备好的指令能够被发射或者插入到发射队列。同时这一步还会把满足依赖的函数插入到 readylist 中。

### InstQueue 的 wakeDependents

这部分进行了很多和内存相关的操作，等待稍后补充。

```cpp
int
InstructionQueue::wakeDependents(const DynInstPtr &completed_inst)
{
    int dependents = 0;

    // The instruction queue here takes care of both floating and int ops
    if (completed_inst->isFloating()) {
        iqIOStats.fpInstQueueWakeupAccesses++;
    } else if (completed_inst->isVector()) {
        iqIOStats.vecInstQueueWakeupAccesses++;
    } else {
        iqIOStats.intInstQueueWakeupAccesses++;
    }

    completed_inst->lastWakeDependents = curTick();

    DPRINTF(IQ, "Waking dependents of completed instruction.\n");

    assert(!completed_inst->isSquashed());

    // Tell the memory dependence unit to wake any dependents on this
    // instruction if it is a memory instruction.  Also complete the memory
    // instruction at this point since we know it executed without issues.
    ThreadID tid = completed_inst->threadNumber;
    if (completed_inst->isMemRef()) {
        memDepUnit[tid].completeInst(completed_inst);

        DPRINTF(IQ, "Completing mem instruction PC: %s [sn:%llu]\n",
            completed_inst->pcState(), completed_inst->seqNum);

        completed_inst->memOpDone(true);
    } else if (completed_inst->isReadBarrier() ||
               completed_inst->isWriteBarrier()) {
        // Completes a non mem ref barrier
        memDepUnit[tid].completeInst(completed_inst);
    }

    for (int dest_reg_idx = 0;
         dest_reg_idx < completed_inst->numDestRegs();
         dest_reg_idx++)
    {
        PhysRegIdPtr dest_reg =
            completed_inst->renamedDestIdx(dest_reg_idx);

        // Special case of uniq or control registers.  They are not
        // handled by the IQ and thus have no dependency graph entry.
        if (dest_reg->isFixedMapping()) {
            DPRINTF(IQ, "Reg %d [%s] is part of a fix mapping, skipping\n",
                    dest_reg->index(), dest_reg->className());
            continue;
        }

        // Avoid waking up dependents if the register is pinned
        dest_reg->decrNumPinnedWritesToComplete();
        if (dest_reg->isPinned())
            completed_inst->setPinnedRegsWritten();

        if (dest_reg->getNumPinnedWritesToComplete() != 0) {
            DPRINTF(IQ, "Reg %d [%s] is pinned, skipping\n",
                    dest_reg->index(), dest_reg->className());
            continue;
        }

        DPRINTF(IQ, "Waking any dependents on register %i (%s).\n",
                dest_reg->index(),
                dest_reg->className());
    }

    return dependents;
}
```
