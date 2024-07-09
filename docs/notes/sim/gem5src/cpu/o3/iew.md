# iew 阶段

IEW 阶段主要分为发射、执行、写回三个阶段，在这个大阶段内，实际上还是细分了流水，将发射和执行写回分成了两个不同的阶段，并且这两个阶段之间是可以设置延迟的。IEW的核心逻辑实现在 `tick` 函数中。

## tick 函数

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

    // 这一步真正的将 store 写回到内存，前面可能进行的是地址转换等等
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

## FUPool 功能池和功能单元实现

功能池和功能单元的实现可以参考[这篇文章](./fu.md)

## 指令队列 InstructionQueue 实现

[InstructionQueue](./inst_queue.md)

## IEW 状态和状态转换

```cpp
enum StageStatus
{
    Running,
    Blocked,
    Idle,
    StartSquash,
    Squashing,
    Unblocking
};
```

Dispatch、Execute、Writeback 都在使用这之中定义的状态。

状态的定义如下：

最基本的，同样是在`IEW::checkSignalsAndUpdate`中进行状态的更新转换，这个过程中的状态转换都是对`dispatchStatus[tid]`的状态进行转换，状态转换如下：

- 无条件状态转换：
  - 接受到来自 commit 的清空信号时候，即 `fromCommit->commitInfo[tid].squash` 被设置的时候，进行各个队列的squash操作，设置状态为 Squashing。
  - 接受到 commit 仍在处理清空的时候，即 `fromCommit->commitInfo[tid].robSquashing` 被设置的时候，状态设置为 Squashing。
  - 检测到可能阻塞的时候(`fromCommit->commitInfo[tid].robSquashing || instQueue.isFull(tid)`)，状态转换为 Blocked。
- 基于先前状态的状态转换：
  - 先前状态为 blocked 的时候，转成 unblocking，如果 skidbuffer 中没有东西，转成 running。
  - 先前状态为 squashing，转成running。

## 指令 dispatch

根据不同的情况添加到不同的队列。

```cpp
void
IEW::dispatchInsts(ThreadID tid)
{
    // 指派数据的来源来自哪里
    std::queue<DynInstPtr> &insts_to_dispatch =
        dispatchStatus[tid] == Unblocking ?
        skidBuffer[tid] : insts[tid];

    int insts_to_add = insts_to_dispatch.size();

    DynInstPtr inst;
    bool add_to_iq = false;
    int dis_num_inst = 0;

    // Loop through the instructions, putting them in the instruction
    // queue.
    for ( ; dis_num_inst < insts_to_add &&
              dis_num_inst < dispatchWidth;
          ++dis_num_inst)
    {
        // 取出头部指令
        inst = insts_to_dispatch.front();

        if (dispatchStatus[tid] == Unblocking) {
            DPRINTF(IEW, "[tid:%i] Issue: Examining instruction from skid "
                    "buffer\n", tid);
        }

        // Make sure there's a valid instruction there.
        assert(inst);

        DPRINTF(IEW, "[tid:%i] Issue: Adding PC %s [sn:%lli] [tid:%i] to "
                "IQ.\n",
                tid, inst->pcState(), inst->seqNum, inst->threadNumber);

        // Be sure to mark these instructions as ready so that the
        // commit stage can go ahead and execute them, and mark
        // them as issued so the IQ doesn't reprocess them.

        // 如果是已经被清空的指令
        if (inst->isSquashed()) {
            DPRINTF(IEW, "[tid:%i] Issue: Squashed instruction encountered, "
                    "not adding to IQ.\n", tid);

            ++iewStats.dispSquashedInsts;

            insts_to_dispatch.pop();

            //Tell Rename That An Instruction has been processed
            if (inst->isLoad()) {
                toRename->iewInfo[tid].dispatchedToLQ++;
            }
            if (inst->isStore() || inst->isAtomic()) {
                toRename->iewInfo[tid].dispatchedToSQ++;
            }

            toRename->iewInfo[tid].dispatched++;

            continue;
        }

        // 如果指令队列满了阻塞
        if (instQueue.isFull(tid)) {
            DPRINTF(IEW, "[tid:%i] Issue: IQ has become full.\n", tid);

            // Call function to start blocking.
            block(tid);

            // Set unblock to false. Special case where we are using
            // skidbuffer (unblocking) instructions but then we still
            // get full in the IQ.
            toRename->iewUnblock[tid] = false;

            ++iewStats.iqFullEvents;
            break;
        }

        // 如果是 load 和 store 用到的满了也会阻塞
        if ((inst->isAtomic() && ldstQueue.sqFull(tid)) ||
            (inst->isLoad() && ldstQueue.lqFull(tid)) ||
            (inst->isStore() && ldstQueue.sqFull(tid))) {
            DPRINTF(IEW, "[tid:%i] Issue: %s has become full.\n",tid,
                    inst->isLoad() ? "LQ" : "SQ");

            // Call function to start blocking.
            block(tid);

            // Set unblock to false. Special case where we are using
            // skidbuffer (unblocking) instructions but then we still
            // get full in the IQ.
            toRename->iewUnblock[tid] = false;

            ++iewStats.lsqFullEvents;
            break;
        }

        // 硬件事务内存相关
        const int numHtmStarts = ldstQueue.numHtmStarts(tid);
        const int numHtmStops = ldstQueue.numHtmStops(tid);
        const int htmDepth = numHtmStarts - numHtmStops;

        // Take some htm message into account.
        if (htmDepth > 0) {
            inst->setHtmTransactionalState(ldstQueue.getLatestHtmUid(tid),
                                            htmDepth);
        } else {
            inst->clearHtmTransactionalState();
        }


        // 后面都是正常的指令调度
        
        // do dispatch

        // the normal execute and ld/st
        if (add_to_iq && inst->isNonSpeculative()) {
            DPRINTF(IEW, "[tid:%i] Issue: Nonspeculative instruction "
                    "encountered, skipping.\n", tid);

            // Same as non-speculative stores.
            inst->setCanCommit();

            // Specifically insert it as nonspeculative.
            instQueue.insertNonSpec(inst);

            ++iewStats.dispNonSpecInsts;

            add_to_iq = false;
        }

        // If the instruction queue is not full, then add the
        // instruction.
        // todo: just insert Spec
        if (add_to_iq) {
            instQueue.insert(inst);
        }

        insts_to_dispatch.pop();

        toRename->iewInfo[tid].dispatched++;

        ++iewStats.dispatchedInsts;

#if TRACING_ON
        inst->dispatchTick = curTick() - inst->fetchTick;
#endif
        ppDispatch->notify(inst);
    }

    if (!insts_to_dispatch.empty()) {
        DPRINTF(IEW,"[tid:%i] Issue: Bandwidth Full. Blocking.\n", tid);
        block(tid);
        toRename->iewUnblock[tid] = false;
    }

    // when dispatch in idle, change the dispatch status.
    if (dispatchStatus[tid] == Idle && dis_num_inst) {
        dispatchStatus[tid] = Running;

        updatedQueues = true;
    }

    dis_num_inst = 0;
}
```

指令具体调度队列：

1. 原子指令：插入到 store queue、插入到 inst queue 中的 nospec 中，add_to_iq 设置成 false，指令设置setCanCommit.
2. load指令：插入到 load queue, add_to_iq 设置成 true。
3. store指令：插入到 store queue。如果是 `StoreConditional`，插入到 inst queue 中的 nospec 中，add_to_iq 设置成 false，指令设置setCanCommit；如果是正常 store，add_to_iq 设置成 true。
4. 屏障指令：insertBarrier 插入到 instQueue 中，设置成 cancommit，add_to_iq 设置成 false。
5. nop指令：设置成 setIssued、setExecuted、setCanCommit，将这条指令设计成生产者指令。
6. 其他情况：设置 add_to_iq 为 true。

对于 add_to_iq 且是非预测性（不能够提前执行，因为状态不能恢复）的指令，setCanCommit，insertNonSpec，然后将 add_to_iq 设置成 false。如果没进入到前一步，说明指令是能够提前执行（可回复状态的）的 instQueue 普通插入这些指令。

如果上述操作完还没把 insts_to_dispatch 中的指令消耗完，那么就阻塞。

## 指令发射

```cpp
void
InstructionQueue::scheduleReadyInsts()
{
    // note that ls/st also in instruction queue
    DPRINTF(IQ, "Attempting to schedule ready instructions from "
            "the IQ.\n");

    IssueStruct *i2e_info = issueToExecuteQueue->access(0);

    DynInstPtr mem_inst;
    // 将推迟的指令加入到 readylist 中
    while ((mem_inst = getDeferredMemInstToExecute())) {
        addReadyMemInst(mem_inst);
    }

    // 把上次阻塞的加到 readylist 中
    while ((mem_inst = getBlockedMemInstToExecute())) {
        addReadyMemInst(mem_inst);
    }

    
    int total_issued = 0;
    ListOrderIt order_it = listOrder.begin();
    ListOrderIt order_end_it = listOrder.end();

    while (total_issued < totalWidth && order_it != order_end_it) {
        OpClass op_class = (*order_it).queueType;

        assert(!readyInsts[op_class].empty());

        // 从 readyinst 中取出指令
        DynInstPtr issuing_inst = readyInsts[op_class].top();

        // 进行相关的统计
        if (issuing_inst->isFloating()) {
            iqIOStats.fpInstQueueReads++;
        } else if (issuing_inst->isVector()) {
            iqIOStats.vecInstQueueReads++;
        } else {
            iqIOStats.intInstQueueReads++;
        }

        assert(issuing_inst->seqNum == (*order_it).oldestInst);

        // 如果这个指令已经被清空
        if (issuing_inst->isSquashed()) {
            readyInsts[op_class].pop();
            
            // 将更老的指令移动到 readyIt 中
            if (!readyInsts[op_class].empty()) {
                moveToYoungerInst(order_it);
            } else {
                readyIt[op_class] = listOrder.end();
                queueOnList[op_class] = false;
            }

            listOrder.erase(order_it++);

            ++iqStats.squashedInstsIssued;

            continue;
        }

        int idx = FUPool::NoCapableFU;
        Cycles op_latency = Cycles(1);
        ThreadID tid = issuing_inst->threadNumber;

        // 如果不属于不受支持的指令类型
        if (op_class != No_OpClass) {
            // 获取空闲的指令单元
            idx = fuPool->getUnit(op_class);
            if (issuing_inst->isFloating()) {
                iqIOStats.fpAluAccesses++;
            } else if (issuing_inst->isVector()) {
                iqIOStats.vecAluAccesses++;
            } else {
                iqIOStats.intAluAccesses++;
            }
            if (idx > FUPool::NoFreeFU) {
                // 获取指令单元相关的延迟
                op_latency = fuPool->getOpLatency(op_class);
            }
        }

        // 如果不属于没受支持的类型
        if (idx != FUPool::NoFreeFU) {
            if (op_latency == Cycles(1)) {
                i2e_info->size++;
                instsToExecute.push_back(issuing_inst);

                // 时钟周期为1 不用建模事件，下个周期直接就好了
                if (idx >= 0)
                    fuPool->freeUnitNextCycle(idx);
            } else {
                bool pipelined = fuPool->isPipelined(op_class);
                // Generate completion event for the FU
                ++wbOutstanding;
                FUCompletion *execution = new FUCompletion(issuing_inst,
                                                           idx, this);

                // 建模并调度执行事件
                cpu->schedule(execution,
                              cpu->clockEdge(Cycles(op_latency - 1)));

                if (!pipelined) {
                    // 告知事件在释放的时候再进行free
                    execution->setFreeFU();
                } else {
                    // 下个周期就能 free 了
                    fuPool->freeUnitNextCycle(idx);
                }
            }

            DPRINTF(IQ, "Thread %i: Issuing instruction PC %s "
                    "[sn:%llu]\n",
                    tid, issuing_inst->pcState(),
                    issuing_inst->seqNum);

            // 从 readyInsts 中删除这条指令
            readyInsts[op_class].pop();

            // 更新 readyIt
            if (!readyInsts[op_class].empty()) {
                moveToYoungerInst(order_it);
            } else {
                readyIt[op_class] = listOrder.end();
                queueOnList[op_class] = false;
            }

            // 将指令设置为已发射
            issuing_inst->setIssued();
            ++total_issued;

#if TRACING_ON
            issuing_inst->issueTick = curTick() - issuing_inst->fetchTick;
#endif

            if (issuing_inst->firstIssue == -1)
                issuing_inst->firstIssue = curTick();

            if (!issuing_inst->isMemRef()) {
                // 不是内存相关的指令直接从 IQ 中移除
                ++freeEntries;
                count[tid]--;
                issuing_inst->clearInIQ();
            } else {
                // 是内存相关的交给 memDepUnit
                memDepUnit[tid].issue(issuing_inst);
            }

            listOrder.erase(order_it++);
            iqStats.statIssuedInstType[tid][op_class]++;
        } else {
            // 没有空闲的留在 readyList队列中
            iqStats.statFuBusy[op_class]++;
            iqStats.fuBusy[tid]++;
            ++order_it;
        }
    }

    iqStats.numIssuedDist.sample(total_issued);
    iqStats.instsIssued+= total_issued;

    // 根据状态判断本阶段是否工作
    if (total_issued || !retryMemInsts.empty() || !deferredMemInsts.empty()) {
        cpu->activityThisCycle();
    } else {
        DPRINTF(IQ, "Not able to schedule any instructions.\n");
    }
}
```

## 指令执行

```cpp
void
IEW::executeInsts()
{
    // execute is just execute result

    wbNumInst = 0;
    wbCycle = 0;

    std::list<ThreadID>::iterator threads = activeThreads->begin();
    std::list<ThreadID>::iterator end = activeThreads->end();

    while (threads != end) {
        ThreadID tid = *threads++;
        fetchRedirect[tid] = false;
    }

    // 获取指令并执行
    int insts_to_execute = fromIssue->size;
    int inst_num = 0;
    // 是完全将队列中能执行的都执行完的
    for (; inst_num < insts_to_execute;
          ++inst_num) {

        DPRINTF(IEW, "Execute: Executing instructions from IQ.\n");

        // 这里的指令是从一个单独的队列中拿的
        DynInstPtr inst = instQueue.getInstToExecute();

        DPRINTF(IEW, "Execute: Processing PC %s, [tid:%i] [sn:%llu].\n",
                inst->pcState(), inst->threadNumber,inst->seqNum);

        // 如果这个监测点有注册到什么事件的话会进行相关的提醒
        ppExecute->notify(inst);

        // 如果已经是被清空的指令
        if (inst->isSquashed()) {
            DPRINTF(IEW, "Execute: Instruction was squashed. PC: %s, [tid:%i]"
                         " [sn:%llu]\n", inst->pcState(), inst->threadNumber,
                         inst->seqNum);

            // 设置指令的相关状态
            inst->setExecuted();
            inst->setCanCommit();

            ++iewStats.executedInstStats.numSquashedInsts;

            continue;
        }

        Fault fault = NoFault;

        // 执行内存相关的指令
        if (inst->isMemRef()) {
            DPRINTF(IEW, "Execute: Calculating address for memory "
                    "reference.\n");

            // 如果是原子指令
            if (inst->isAtomic()) {
                // 调用 load/store queue 执行inst
                fault = ldstQueue.executeStore(inst);

                if (inst->isTranslationDelayed() &&
                    fault == NoFault) {
                    // 因为TLB的原因必须推迟
                    DPRINTF(IEW, "Execute: Delayed translation, deferring "
                            "store.\n");
                    instQueue.deferMemInst(inst);
                    continue;
                }
            } else if (inst->isLoad()) {
                // 调用 load/store queue 执行inst
                fault = ldstQueue.executeLoad(inst);

                if (inst->isTranslationDelayed() &&
                    fault == NoFault) {
                    // 和上面一样可能是某些原因导致的推迟
                    DPRINTF(IEW, "Execute: Delayed translation, deferring "
                            "load.\n");
                    instQueue.deferMemInst(inst);
                    continue;
                }

                if (inst->isDataPrefetch() || inst->isInstPrefetch()) {
                    inst->fault = NoFault;
                }
            } else if (inst->isStore()) {
                fault = ldstQueue.executeStore(inst);

                if (inst->isTranslationDelayed() &&
                    fault == NoFault) {
                    
                    DPRINTF(IEW, "Execute: Delayed translation, deferring "
                            "store.\n");
                    instQueue.deferMemInst(inst);
                    continue;
                }

                // 如果出错了直接就把这个指令扔到后面提交了
                if (fault != NoFault || !inst->readPredicate() ||
                        !inst->isStoreConditional()) {
                    // If the instruction faulted, then we need to send it
                    // along to commit without the instruction completing.
                    // Send this instruction to commit, also make sure iew
                    // stage realizes there is activity.
                    inst->setExecuted();
                    instToCommit(inst);
                    activityThisCycle();
                }

                // Store conditionals will mark themselves as
                // executed, and their writeback event will add the
                // instruction to the queue to commit.
            } else {
                panic("Unexpected memory type!\n");
            }

        } else {
            // 其他指令直接正常执行
            if (inst->getFault() == NoFault) {
                inst->execute();
                if (!inst->readPredicate())
                    // 如果这条指令受到谓词寄存器的影响
                    // 这条指令的值延续该体系结构寄存器对应的上一个寄存器的值
                    inst->forwardOldRegs();
            }

            // 设置成已经执行的状态
            inst->setExecuted();

            // 将指令向 commit 阶段发送
            instToCommit(inst);
        }

        // 更新相关的统计指标
        updateExeInstStats(inst);

        // Check if branch prediction was correct, if not then we need
        // to tell commit to squash in flight instructions.  Only
        // handle this if there hasn't already been something that
        // redirects fetch in this group of instructions.

        // This probably needs to prioritize the redirects if a different
        // scheduler is used.  Currently the scheduler schedules the oldest
        // instruction first, so the branch resolution order will be correct.
        ThreadID tid = inst->threadNumber;

        if (!fetchRedirect[tid] ||
            !toCommit->squash[tid] ||
            toCommit->squashedSeqNum[tid] > inst->seqNum) {

            // Prevent testing for misprediction on load instructions,
            // that have not been executed.
            bool loadNotExecuted = !inst->isExecuted() && inst->isLoad();

            if (inst->mispredicted() && !loadNotExecuted) {
                fetchRedirect[tid] = true;

                DPRINTF(IEW, "[tid:%i] [sn:%llu] Execute: "
                        "Branch mispredict detected.\n",
                        tid, inst->seqNum);
                DPRINTF(IEW, "[tid:%i] [sn:%llu] "
                        "Predicted target was PC: %s\n",
                        tid, inst->seqNum, inst->readPredTarg());
                DPRINTF(IEW, "[tid:%i] [sn:%llu] Execute: "
                        "Redirecting fetch to PC: %s\n",
                        tid, inst->seqNum, inst->pcState());
                // 如果预测错误
                squashDueToBranch(inst, tid);

                ppMispredict->notify(inst);

                if (inst->readPredTaken()) {
                    iewStats.predictedTakenIncorrect++;
                } else {
                    iewStats.predictedNotTakenIncorrect++;
                }
            } else if (ldstQueue.violation(tid)) {
                assert(inst->isMemRef());
                // 如果违反了内存序
                DynInstPtr violator;
                violator = ldstQueue.getMemDepViolator(tid);

                DPRINTF(IEW, "LDSTQ detected a violation. Violator PC: %s "
                        "[sn:%lli], inst PC: %s [sn:%lli]. Addr is: %#x.\n",
                        violator->pcState(), violator->seqNum,
                        inst->pcState(), inst->seqNum, inst->physEffAddr);

                fetchRedirect[tid] = true;

                // Tell the instruction queue that a violation has occured.
                instQueue.violation(inst, violator);

                // Squash.
                squashDueToMemOrder(violator, tid);

                ++iewStats.memOrderViolationEvents;
            }
        } else {
            // Reset any state associated with redirects that will not
            // be used.
            // 暂时不明
            if (ldstQueue.violation(tid)) {
                assert(inst->isMemRef());

                DynInstPtr violator = ldstQueue.getMemDepViolator(tid);

                DPRINTF(IEW, "LDSTQ detected a violation.  Violator PC: "
                        "%s, inst PC: %s.  Addr is: %#x.\n",
                        violator->pcState(), inst->pcState(),
                        inst->physEffAddr);
                DPRINTF(IEW, "Violation will not be handled because "
                        "already squashing\n");

                ++iewStats.memOrderViolationEvents;
            }
        }
    }

    // Update and record activity if we processed any instructions.
    if (inst_num) {
        if (exeStatus == Idle) {
            exeStatus = Running;
        }

        updatedQueues = true;

        cpu->activityThisCycle();
    }

    
    wbNumInst = 0;

}
```

## 指令写回

这一步只唤醒依赖，对于依赖满足的指令，将其放到readyinst队列中。

前面的执行步骤和这边的依赖唤醒共同构成了写回到物理寄存器和前递的过程，指令在执行的时候调用 execute 就会计算其结果，然后更新到物理寄存器上，在写回进行唤醒依赖的时候，一旦依赖满足后续指令就能够继续向下进行。整个过程就是一个写回物理寄存器在前递的过程。

