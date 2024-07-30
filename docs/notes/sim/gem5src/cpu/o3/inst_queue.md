# InstructionQueue 实现

## DependencyGraph 实现

只是一个非常简单的链表数组表示依赖关系。具体见[这篇文章](dep_graph.md).

## FUCompletion

像是对某个功能单元使用完成的建模。

### processFUCompletion 回调函数

## 数据结构

1. `std::list<ListOrderEntry> listOrder`：存放readyInsts中年龄最大的指令，也就是InstSeq最小的指令。
2. `ReadyInstQueue readyInsts[Num_OpClasses]`：已经准备好能够发射的指令。

## entry 相关 api

1. entryAmount：根据线程数返回在 SMTQueuePolicy::Partitioned 策略下每个线程应该有多少 entry。
2. resetEntries：根据 activeThreads 中线程数动态设置每个线程的 maxEntries 数量。
3. 无参numFreeEntries：返回全局空闲数。
4. 带参numFreeEntries：返回每个线程的空闲数。
5. 无参isFull：通过无参numFreeEntries检查整体的IQ是否已经满了。
6. 带参isFull：通过带参numFreeEntries检查整体的IQ是否已经满了。

## 寄存器依赖相关

### addToDependents

```cpp
bool
InstructionQueue::addToDependents(const DynInstPtr &new_inst)
{
    // 如果源寄存器还没准备好，将指令插入到依赖图中
    int8_t total_src_regs = new_inst->numSrcRegs();
    bool return_val = false;

    for (int src_reg_idx = 0;
         src_reg_idx < total_src_regs;
         src_reg_idx++)
    {
        // 还没准备好就加入到依赖图中
        if (!new_inst->readySrcIdx(src_reg_idx)) {
            PhysRegIdPtr src_reg = new_inst->renamedSrcIdx(src_reg_idx);readyIt
            if (src_reg->isFixedMapping()) {
                // 对于不可重命名的寄存器直接忽略
                continue;
            } else if (!regScoreboard[src_reg->flatIndex()]) {
                // 依赖确实还没准备好，插入到依赖图中
                dependGraph.insert(src_reg->flatIndex(), new_inst);
                // 更改返回值
                return_val = true;
            } else {
                // 将指令的某个寄存器标记为依赖已经满足
                new_inst->markSrcRegReady(src_reg_idx);
            }
        }
    }

    return return_val;
}
```

### addToProducers

```cpp
void
InstructionQueue::addToProducers(const DynInstPtr &new_inst)
{readyIt
    int8_t total_dest_regs = new_inst->numDestRegs();

    for (int dest_reg_idx = 0;
         dest_reg_idx < total_dest_regs;
         dest_reg_idx++)
    {
        PhysRegIdPtr dest_reg = new_inst->renamedDestIdx(dest_reg_idx);

        // 如果不可重命名
        if (dest_reg->isFixedMapping()) {
            continue;
        }

        // 重命名到的目的寄存器应该是空的
        // 如果依赖图没空说明上次没清空完
        // 直接 panic
        if (!dependGraph.empty(dest_reg->flatIndex())) {
            dependGraph.dump();
            panic("Dependency graph %i (%s) (flat: %i) not empty!",
                  dest_reg->index(), dest_reg->className(),
                  dest_reg->flatIndex());
        }

        // 将依赖图的头节点设置为目的寄存器
        dependGraph.setInst(dest_reg->flatIndex(), new_inst);

        // 修改记分牌
        regScoreboard[dest_reg->flatIndex()] = false;
    }
}
```

## 插入相关

### addToOrderList

```cpp
void
InstructionQueue::addToOrderList(OpClass op_class)
{
    assert(!readyInsts[op_class].empty());

    ListOrderEntry queue_entry;

    queue_entry.queueType = op_class;

    // readyInsts 中的 top 就是最老指令，因为其是优先队列
    queue_entry.oldestInst = readyInsts[op_class].top()->seqNum;

    ListOrderIt list_it = listOrder.begin();
    ListOrderIt list_end_it = listOrder.end();

    // 查看每个 op_class 最老的应该插入到什么位置
    while (list_it != list_end_it) {
        if ((*list_it).oldestInst > queue_entry.oldestInst) {
            break;
        }

        list_it++;
    }

    // 插入到 readyIt 队列中，这个队列也是按 seqnumber 排列的，只不过不区分 op_class
    readyIt[op_class] = listOrder.insert(list_it, queue_entry);
    // 设置 queueOnList 为 true，当前 op_class 在 listOrder 中已经存在
    queueOnList[op_class] = true;
}
```

这个函数实际上是将 ready 的迭代器按照序号顺序排在 listOrder 队列中，在发射阶段按照顺序指派就是这样。

### addIfReady

这个方法尝试将指令设置到 ready 状态。

```cpp
void
InstructionQueue::addIfReady(const DynInstPtr &inst)
{
    // 指令还没 ready 无事发生
    if (inst->readyToIssue()) {

        //Add the instruction to the proper ready list.
        if (inst->isMemRef()) {

            // 内存相关的指令交到 memDepUnit 中
            memDepUnit[inst->threadNumber].regsReady(inst);

            return;
        }

        OpClass op_class = inst->opClass();

        // 非内存相关插入到 readyinst 中
        readyInsts[op_class].push(inst);

        // 如果当前 op_class 不在 listOrder 中
        if (!queueOnList[op_class]) {
            addToOrderList(op_class);
        } else if (readyInsts[op_class].top()->seqNum  <
                   (*readyIt[op_class]).oldestInst) {
            // 在 listOrder 中但是有更老的指令出现了
            // 需要将 listOrder 中更新成最老的指令
            listOrder.erase(readyIt[op_class]);
            addToOrderList(op_class);
        }
    }
}
```

### insert

```cpp
void
InstructionQueue::insert(const DynInstPtr &new_inst)
{
    // stat ... 
    // 检查指令是否合法
    assert(new_inst);

    DPRINTF(IQ, "Adding instruction [sn:%llu] PC %s to the IQ.\n",
            new_inst->seqNum, new_inst->pcState());

    assert(freeEntries != 0);

    // 类似于其他阶段中的 insts 数组
    instList[new_inst->threadNumber].push_back(new_inst);

    --freeEntries;

    new_inst->setInIQ();

    // 分别处理源寄存器和目的寄存器的依赖相关
    addToDependents(new_inst);
    addToProducers(new_inst);

    if (new_inst->isMemRef()) {
        // 如果是访问内存相关的指令 要发送到 memDepUnit
        memDepUnit[new_inst->threadNumber].insert(new_inst);
    } else {
        // 检测这条指令是不是 ready，如果准备好进行一系列操作移入 readyInsts
        addIfReady(new_inst);
    }

    ++iqStats.instsAdded;

    // 增加单个线程使用的 entry 计数
    count[new_inst->threadNumber]++;

    assert(freeEntries == (numEntries - countInsts()));
}
```

### insertNonSpec

和 insert 几乎相同，但是：

1. 维护专用的 seqnum->inst 的 map。指令会被插入到这个 map 中。
2. 只进行addToProducers，也就是只将目的寄存器设置为Producer。**为什么**？
3. 没有进行 if ready 的判断。**为什么**？

### insertBarrier

直接调用了 `insertNonSpec`，与此同时还将屏障指令插入到 memDepUnit 中。

## 指令发射(issue)

### scheduleReadyInsts

```cpp
void
InstructionQueue::scheduleReadyInsts()
{
    // note that ls/st also in instruction queue
    DPRINTF(IQ, "Attempting to schedule ready instructions from "
            "the IQ.\n");

    // 这就类似于 wire，准备把东西放到 IssueStruct 传输到 Execute 
    IssueStruct *i2e_info = issueToExecuteQueue->access(0);

    DynInstPtr mem_inst;
    // 将先前推迟的加入到 readyInsts，并尝试加入到 listOrder 中
    while ((mem_inst = getDeferredMemInstToExecute())) {
        addReadyMemInst(mem_inst);
    }

    // 将先前阻塞的加入到 readyInsts，并尝试加入到 listOrder 中
    while ((mem_inst = getBlockedMemInstToExecute())) {
        addReadyMemInst(mem_inst);
    }

    int total_issued = 0;
    ListOrderIt order_it = listOrder.begin();
    ListOrderIt order_end_it = listOrder.end();

    // 是从 listOrder 中选出来调度
    while (total_issued < totalWidth && order_it != order_end_it) {
        OpClass op_class = (*order_it).queueType;

        assert(!readyInsts[op_class].empty());

        DynInstPtr issuing_inst = readyInsts[op_class].top();

        if (issuing_inst->isFloating()) {
            iqIOStats.fpInstQueueReads++;
        } else if (issuing_inst->isVector()) {
            iqIOStats.vecInstQueueReads++;
        } else {
            iqIOStats.intInstQueueReads++;
        }

        // 双重验证？

        assert(issuing_inst->seqNum == (*order_it).oldestInst);

        // squash 并没有导致从 readyinst中移除？
        if (issuing_inst->isSquashed()) {
            readyInsts[op_class].pop();

            if (!readyInsts[op_class].empty()) {
                moveToYoungerInst(order_it);
            } else {
                // 如果没有准备好的指令 将迭代器设置成false
                readyIt[op_class] = listOrder.end();
                queueOnList[op_class] = false;
            }

            // 在 moveToYoungerInst 中没删掉的在这里删
            listOrder.erase(order_it++);

            ++iqStats.squashedInstsIssued;

            continue;
        }

        int idx = FUPool::NoCapableFU;
        Cycles op_latency = Cycles(1);
        ThreadID tid = issuing_inst->threadNumber;

        if (op_class != No_OpClass) {
            idx = fuPool->getUnit(op_class);
            // 这只是尝试访问功能单元的计数，指令都还没发射呢
            if (issuing_inst->isFloating()) {
                iqIOStats.fpAluAccesses++;
            } else if (issuing_inst->isVector()) {
                iqIOStats.vecAluAccesses++;
            } else {
                iqIOStats.intAluAccesses++;
            }
            if (idx > FUPool::NoFreeFU) {
                // 没有空闲单元就等待一个最长延迟在做调度
                op_latency = fuPool->getOpLatency(op_class);
            }
        }

        // 如果找到了合适的功能单元
        if (idx != FUPool::NoFreeFU) {
            if (op_latency == Cycles(1)) {
                i2e_info->size++;
                instsToExecute.push_back(issuing_inst);

                // 只有一个时钟周期，不需要事件建模，用完直接释放了
                if (idx >= 0)
                    fuPool->freeUnitNextCycle(idx);
            } else {
                bool pipelined = fuPool->isPipelined(op_class);
                // 大于一个时钟周期的需要建模事件
                ++wbOutstanding;
                FUCompletion *execution = new FUCompletion(issuing_inst,
                                                           idx, this);

                // 在延时的前一个时钟周期释放相关的资源
                cpu->schedule(execution,
                              cpu->clockEdge(Cycles(op_latency - 1)));

                if (!pipelined) {
                    // 如果非流水线实现，FU智能等待时间到了释放
                    execution->setFreeFU();
                } else {
                    // 流水线化实现下个周期就能释放
                    fuPool->freeUnitNextCycle(idx);
                }
            }

            DPRINTF(IQ, "Thread %i: Issuing instruction PC %s "
                    "[sn:%llu]\n",
                    tid, issuing_inst->pcState(),
                    issuing_inst->seqNum);

            // readyInsts  中丢掉已经发射的指令
            readyInsts[op_class].pop();

            if (!readyInsts[op_class].empty()) {
                moveToYoungerInst(order_it);
            } else {
                readyIt[op_class] = listOrder.end();
                queueOnList[op_class] = false;
            }

            // 设置指令为已发射状态
            issuing_inst->setIssued();
            ++total_issued;

            // 记录覅一次发射的时间
            if (issuing_inst->firstIssue == -1)
                issuing_inst->firstIssue = curTick();

            if (!issuing_inst->isMemRef()) {
                // 非内存类的指令已经可以从IQ释放了
                ++freeEntries;
                count[tid]--;
                issuing_inst->clearInIQ();
            } else {
                // 内存类指令不行
                memDepUnit[tid].issue(issuing_inst);
            }

            // 从 listOrder 中移除发射的指令
            listOrder.erase(order_it++);
            iqStats.statIssuedInstType[tid][op_class]++;
        } else {
            iqStats.statFuBusy[op_class]++;
            iqStats.fuBusy[tid]++;
            // 没有FU就从 listOrder 选取下一个条目
            ++order_it;
        }
    }

    iqStats.numIssuedDist.sample(total_issued);
    iqStats.instsIssued+= total_issued;

    // 设置本阶段活动状态
    if (total_issued || !retryMemInsts.empty() || !deferredMemInsts.empty()) {
        cpu->activityThisCycle();
    } else {
        DPRINTF(IQ, "Not able to schedule any instructions.\n");
    }
}
```

### scheduleNonSpec

```cpp
void
InstructionQueue::scheduleNonSpec(const InstSeqNum &inst)
{
    DPRINTF(IQ, "Marking nonspeculative instruction [sn:%llu] as ready "
            "to execute.\n", inst);

    NonSpecMapIt inst_it = nonSpecInsts.find(inst);

    assert(inst_it != nonSpecInsts.end());

    ThreadID tid = (*inst_it).second->threadNumber;

    (*inst_it).second->setAtCommit();

    (*inst_it).second->setCanIssue();

    if (!(*inst_it).second->isMemRef()) {
        addIfReady((*inst_it).second);
    } else {
        memDepUnit[tid].nonSpecInstReady((*inst_it).second);
    }

    (*inst_it).second = NULL;

    nonSpecInsts.erase(inst_it);
}
```

不太清楚意图，似乎想将其加入到 ready 队列中。

## wakeDependents

似乎是在指令 completed 之后调用这个函数。

```cpp
int
InstructionQueue::wakeDependents(const DynInstPtr &completed_inst)
{
    int dependents = 0;

    // 统计计数
    if (completed_inst->isFloating()) {
        iqIOStats.fpInstQueueWakeupAccesses++;
    } else if (completed_inst->isVector()) {
        iqIOStats.vecInstQueueWakeupAccesses++;
    } else {
        iqIOStats.intInstQueueWakeupAccesses++;
    }

    // 更新上次 wakeup 时间
    completed_inst->lastWakeDependents = curTick();

    DPRINTF(IQ, "Waking dependents of completed instruction.\n");

    assert(!completed_inst->isSquashed());

    // Tell the memory dependence unit to wake any dependents on this
    // instruction if it is a memory instruction.  Also complete the memory
    // instruction at this point since we know it executed without issues.
    ThreadID tid = completed_inst->threadNumber;
    if (completed_inst->isMemRef()) {
        // 尝试完成内存命令 或者已经完成
        memDepUnit[tid].completeInst(completed_inst);

        DPRINTF(IQ, "Completing mem instruction PC: %s [sn:%llu]\n",
            completed_inst->pcState(), completed_inst->seqNum);

        // 正式从 IQ 中移除这个指令
        ++freeEntries;
        completed_inst->memOpDone(true);
        count[tid]--;
    } else if (completed_inst->isReadBarrier() ||
               completed_inst->isWriteBarrier()) {
        // 尝试完成内存屏障 或者已经完成
        memDepUnit[tid].completeInst(completed_inst);
    }

    for (int dest_reg_idx = 0;
         dest_reg_idx < completed_inst->numDestRegs();
         dest_reg_idx++)
    {
        PhysRegIdPtr dest_reg =
            completed_inst->renamedDestIdx(dest_reg_idx);

        // 不能重命名直接返回
        if (dest_reg->isFixedMapping()) {
            DPRINTF(IQ, "Reg %d [%s] is part of a fix mapping, skipping\n",
                    dest_reg->index(), dest_reg->className());
            continue;
        }

        // 如果属于多个寄存器联合成一个寄寄存器
        // 这种寄存器只需要标记一次
        dest_reg->decrNumPinnedWritesToComplete();
        if (dest_reg->isPinned())
            completed_inst->setPinnedRegsWritten();

        // 只有降到0的时候才能向下进行
        if (dest_reg->getNumPinnedWritesToComplete() != 0) {
            DPRINTF(IQ, "Reg %d [%s] is pinned, skipping\n",
                    dest_reg->index(), dest_reg->className());
            continue;
        }

        DPRINTF(IQ, "Waking any dependents on register %i (%s).\n",
                dest_reg->index(),
                dest_reg->className());

        // 从依赖图中找出消费者指令进行唤醒
        DynInstPtr dep_inst = dependGraph.pop(dest_reg->flatIndex());

        while (dep_inst) {
            DPRINTF(IQ, "Waking up a dependent instruction, [sn:%llu] "
                    "PC %s.\n", dep_inst->seqNum, dep_inst->pcState());

            // 标记寄存器已经准备好
            dep_inst->markSrcRegReady();

            // 尝试将其加入到 Ready 队列
            addIfReady(dep_inst);

            // 从依赖图中移除这条指令吃
            dep_inst = dependGraph.pop(dest_reg->flatIndex());

            // 增加处理的计数
            ++dependents;
        }

        assert(dependGraph.empty(dest_reg->flatIndex()));
        // 清除生产者的信息
        dependGraph.clearInst(dest_reg->flatIndex());

        // 修改比分牌
        regScoreboard[dest_reg->flatIndex()] = true;
    }
    // 返回处理掉的依赖数
    return dependents;
}

```

## doSquash

```cpp
void
InstructionQueue::doSquash(ThreadID tid)
{
    // 从尾部开始
    ListIt squash_it = instList[tid].end();
    --squash_it;

    // 并没有真正的从listInst中删除，只是简单的设置标志以后做处理

    DPRINTF(IQ, "[tid:%i] Squashing until sequence number %i!\n",
            tid, squashedSeqNum[tid]);

    // Squash any instructions younger than the squashed sequence number
    // given.
    while (squash_it != instList[tid].end() &&
           (*squash_it)->seqNum > squashedSeqNum[tid]) {

        DynInstPtr squashed_inst = (*squash_it);
        if (squashed_inst->isFloating()) {
            iqIOStats.fpInstQueueWrites++;
        } else if (squashed_inst->isVector()) {
            iqIOStats.vecInstQueueWrites++;
        } else {
            iqIOStats.intInstQueueWrites++;
        }

        // 处理不太可能发生的情况
        if (squashed_inst->threadNumber != tid ||
            squashed_inst->isSquashedInIQ()) {
            --squash_it;
            continue;
        }

        if (!squashed_inst->isIssued() ||
            (squashed_inst->isMemRef() &&
             !squashed_inst->memOpDone())) {

            DPRINTF(IQ, "[tid:%i] Instruction [sn:%llu] PC %s squashed.\n",
                    tid, squashed_inst->seqNum, squashed_inst->pcState());

            bool is_acq_rel = squashed_inst->isFullMemBarrier() &&
                         (squashed_inst->isLoad() ||
                          (squashed_inst->isStore() &&
                             !squashed_inst->isStoreConditional()));

            // 处理依赖图
            if (is_acq_rel ||
                (!squashed_inst->isNonSpeculative() &&
                 !squashed_inst->isStoreConditional() &&
                 !squashed_inst->isAtomic() &&
                 !squashed_inst->isReadBarrier() &&
                 !squashed_inst->isWriteBarrier())) {

                for (int src_reg_idx = 0;
                     src_reg_idx < squashed_inst->numSrcRegs();
                     src_reg_idx++)
                {
                    PhysRegIdPtr src_reg =
                        squashed_inst->renamedSrcIdx(src_reg_idx);

                    
                    if (!squashed_inst->readySrcIdx(src_reg_idx) &&
                        !src_reg->isFixedMapping()) {
                        dependGraph.remove(src_reg->flatIndex(),
                                           squashed_inst);
                    }

                    ++iqStats.squashedOperandsExamined;
                }

            } else if (!squashed_inst->isStoreConditional() ||
                       !squashed_inst->isCompleted()) {
                // 处理 nonSpecInsts 这个队列
                NonSpecMapIt ns_inst_it =
                    nonSpecInsts.find(squashed_inst->seqNum);

                
                if (ns_inst_it == nonSpecInsts.end()) {
                    assert(squashed_inst->getFault() != NoFault ||
                           squashed_inst->isMemRef());
                } else {

                    (*ns_inst_it).second = NULL;

                    nonSpecInsts.erase(ns_inst_it);

                    ++iqStats.squashedNonSpecRemoved;
                }
            }

            
            squashed_inst->setSquashedInIQ();

        
            squashed_inst->setIssued();
            squashed_inst->setCanCommit();
            squashed_inst->clearInIQ();

            //从 IQ 中移除
            count[squashed_inst->threadNumber]--;

            ++freeEntries;
        }

        // 继续清楚依赖图相关
        for (int dest_reg_idx = 0;
             dest_reg_idx < squashed_inst->numDestRegs();
             dest_reg_idx++)
        {
            PhysRegIdPtr dest_reg =
                squashed_inst->renamedDestIdx(dest_reg_idx);
            if (dest_reg->isFixedMapping()){
                continue;
            }
            assert(dependGraph.empty(dest_reg->flatIndex()));
            dependGraph.clearInst(dest_reg->flatIndex());
        }
        instList[tid].erase(squash_it--);
        ++iqStats.squashedInstsExamined;
    }
}

```

## 指令进入 readyInsts 队列的时机

通过调用 addIfReady 进入到 readyInsts 中。

1. InstructionQueue::insert：在指令被插入到 IQ 中，在插入的时候对于非内存类的指令会进行 addIfReady 判断，符合的会直接进入到 ready 队列中。
2. InstructionQueue::scheduleNonSpec：对于非内存的指令会进行 addIfReady 的判断。
3. InstructionQueue::wakeDependents：当某个生产者满足，开始唤醒依赖的时候会进行 addIfReady 的判断。

## 指令在 instList 中的相关操作

1. InstructionQueue::insert 和 InstructionQueue::insertNonSpec 中进行插入。
2. InstructionQueue::commit 的时候根据序列号删除相关的节点。
3. InstructionQueue::doSquash 的时候根据序列号进行相关的清空。

## 指令状态变更

1. InstructionQueue::insert 和 InstructionQueue::insertNonSpec 中标记指令 setInIQ。
2. InstructionQueue::scheduleReadyInsts 中对于成功发射的指令设置 setIssued。
3. 在 InstructionQueue::scheduleNonSpec 中设置 setAtCommit 和 setCanIssue，暂时不明确这两个是什么意思。
4. InstructionQueue::wakeDependents 中对于内存类指令，设置 memOpDone = true。
5. InstructionQueue::wakeDependents 中对于依赖图中的消费者指令，进行 markSrcRegReady 的调用，注意，这里只改变了 dyninst 中已经准备好的寄存器的计数，并不知道哪个寄存器准备好，在 markSrcRegReady 中，如果所有寄存器都准备好，指令状态被设置成 setCanIssue。
6. rescheduleMemInst 中 clearCanIssue。
7. blockMemInst 中 clearIssued 和 clearCanIssue。
8. InstructionQueue::doSquash 中，对于清空的指令 setSquashedInIQ、setIssued(设置成已经发射)、setCanCommit、clearInIQ(设置逻辑上从 IQ 移除)。这里的清空只是对指令进行了相关的标记，对于还在 instList 中的指令，在 commit 的时候，会将他们移除。
9. InstructionQueue::addToDependents 会对所需的寄存器依赖进行检测，如果依赖已经满足，调用 `markSrcRegReady(src_reg_idx)`。
10. InstructionQueue::addIfReady 中 readyToIssue 就是对 CanIssue 标志的判断。

## 其他 api

1. `getInstToExecute`：从 instsToExecute 中拿出头部并返回。
2. `moveToYoungerInst`：用某个 op_class 中新的指令代替 readyIt 中旧的指令，旧的指令后续可能会被移除。
3. `commit`：对于某个tid，commit小于等于某个序列号的指令。
4. `addReadyMemInst`：尝试将某个内存指令加入到 listOrder 中。
5. `rescheduleMemInst`：尝试重新调度某个内存指令。
6. `replayMemInst`：好像也是重新执行某个内存指令。
7. `deferMemInst`：推迟某个内存指令，把指令塞到 deferredMemInsts 中。
8. `blockMemInst`：阻塞某个内存指令，把指令塞到 blockedMemInsts 中。
9. `cacheUnblocked`：cache block已经解决，将 blockedMemInsts 中数据移到 retryMemInsts 中，重新尝试访问。注意还有可能移回来。
10. `getDeferredMemInstToExecute`：不断返回被推迟执行的内存指令。
11. `getBlockedMemInstToExecute`：不断返回被阻塞的内存指令。
12. `violation`：实际调用 memDepUnit 的 violation。
13. `squash`：进行清空操作。
