# Commit 阶段

commit 阶段在 iew 阶段之后，主要负责指令的提交，由于 iew 阶段需要频繁与 commit 阶段交互，因此首先对 commit 阶段有所理解十分重要。这篇文章主要对 commit 阶段的相关内容进行讲解。

## 传递的信息

从 commit 的类成员可以看出来，commit 阶段会向前面阶段传递传递信息，因此首先理解这个传递的数据结构是很重要的，给出这个数据结构：

```cpp
struct CommitComm
{

    // 下一条指令的pc地址，预测错误的时候使用；在违反内存序的时候这个值不变
    std::unique_ptr<PCStateBase> pc; // *F

    // 指向预测错误的那条指令
    DynInstPtr mispredictInst;  // *F

    // 在非预测错误下，造成流水线清空的指令
    DynInstPtr squashInst; // *F

    // 严格有序访问的指令
    DynInstPtr strictlyOrderedLoad; // *I

    // 向前告知当前已经提交到的非预测性的指令
    InstSeqNum nonSpecSeqNum; // *I

    // 当前已经 commit 到哪条指令了
    InstSeqNum doneSeqNum; // *F, I

    // 当前ROB的空闲数
    unsigned freeROBEntries; // *R

    // 首次触发 squash 的时间
    bool squash; // *F, D, R, I
    
    // 仍然在处理 squash，这是因为单个周期能够处理的 squash 的问题
    bool robSquashing; // *F, D, R, I

    /// Rename should re-read number of free rob entries
    bool usedROB; // *R

    /// Notify Rename that the ROB is empty
    bool emptyROB; // *R

    // 告知分支发生与否
    bool branchTaken; // *F

    // 中断被悬停等待
    bool interruptPending; // *F

    // 中断在这个周期被处理
    bool clearInterrupt; // *F

    // 告知IEW阶段强行执行内存序的手段
    bool strictlyOrdered; // *I

};
```

## o3 cpu startup 阶段

在 o3 cpu 的 startup 阶段，会触发 commit 的 startupStage 方法，这个方法如下：

```cpp
void
Commit::startupStage()
{
    // 进行 ROB 相关的初始化
    rob->setActiveThreads(activeThreads);
    rob->resetEntries();

    // 广播 ROB 的空闲情况，usedROB 很可能是告诉前阶段 ROB 可用，
    // 或者说是告诉前阶段可以读取 ROB 的相关信息
    for (ThreadID tid = 0; tid < numThreads; tid++) {
        toIEW->commitInfo[tid].usedROB = true;
        toIEW->commitInfo[tid].freeROBEntries = rob->numFreeEntries(tid);
        toIEW->commitInfo[tid].emptyROB = true;
    }

    cpu->activateStage(CPU::CommitIdx);
    cpu->activityThisCycle();
}
```

## 执行阶段

执行阶段仍然和之前一样，主要执行的是 tick 阶段的函数，首先对 tick 阶段的主要脉络进行分析，随后逐个函数进行分析：

```cpp
void
Commit::tick()
{
    wroteToTimeBuffer = false;
    // 首先默认下个周期这个流水线阶段不会被激活
    _nextStatus = Inactive;

    // 如果当前没有活动线程，就等于没有可人提交的，于是直接返回
    if (activeThreads->empty())
        return;

    std::list<ThreadID>::iterator threads = activeThreads->begin();
    std::list<ThreadID>::iterator end = activeThreads->end();

    // 检查之前的流水线清空(squash)是否完成，如果完成则会尝试改变一些状态
    while (threads != end) {
        ThreadID tid = *threads++;

        // 当前阶段有没有 store 被提交
        committedStores[tid] = false;

        // 如果先前处于 ROBSquashing 状态
        // 注意在触发流水线清空之后，不管前一个阶段是否处理完，状态都会被设置为 ROBSquashing
        // 因此在下个阶段开始的时候进行检查，如果处理完了就改变下状态，然后继续干本阶段的事
        //                             如果没处理完就当前阶段继续处理，然后干本阶段的事
        // 这里保证的是每个周期都能进行流水线的清空
        if (commitStatus[tid] == ROBSquashing) {

            if (rob->isDoneSquashing(tid)) {
                // 如果处理完了更改状态
                commitStatus[tid] = Running;
            } else {
                DPRINTF(Commit,"[tid:%i] Still Squashing, cannot commit any"
                        " insts this cycle.\n", tid);
                // 如果没处理完继续处理
                rob->doSquash(tid);
                // 告知前面阶段，本阶段仍然在处理流水线的排空
                // 至少到本阶段为止，流水线排空还没完成
                toIEW->commitInfo[tid].robSquashing = true;
                wroteToTimeBuffer = true;
            }
        }
    }

    // 核心函数，在这个函数中尝试进行ROB的commit
    // 正是在提交的过程中可能会触发流水线清空
    commit();

    // 将 IEW 阶段传过来的指令标记为可提交的，如果 IEW 把某条指令传过来，
    // 说明这条指令已经执行写回完了，可以提交了
    // Rename阶段：将指令提前放到 ROB 中
    // IEW阶段：将指令标记为可提交的，这样 ROB 中的相关指令在下个阶段就能被提交了
    markCompletedInsts();

    threads = activeThreads->begin();

    // 这边只是 log 相关的信息，在前面将 IEW 阶段传送过来的指令标记为能够提交之后,
    // 看看重排序缓冲中是否有指令准备好提交了
    while (threads != end) {
        ThreadID tid = *threads++;

        if (!rob->isEmpty(tid) && rob->readHeadInst(tid)->readyToCommit()) {
            // The ROB has more instructions it can commit. Its next status
            // will be active.
            _nextStatus = Active;

            [[maybe_unused]] const DynInstPtr &inst = rob->readHeadInst(tid);

            DPRINTF(Commit,"[tid:%i] Instruction [sn:%llu] PC %s is head of"
                    " ROB and ready to commit\n",
                    tid, inst->seqNum, inst->pcState());

        } else if (!rob->isEmpty(tid)) {
            const DynInstPtr &inst = rob->readHeadInst(tid);

            ppCommitStall->notify(inst);

            DPRINTF(Commit,"[tid:%i] Can't commit, Instruction [sn:%llu] PC "
                    "%s is head of ROB and not ready\n",
                    tid, inst->seqNum, inst->pcState());
        }

        DPRINTF(Commit, "[tid:%i] ROB has %d insts & %d free entries.\n",
                tid, rob->countInsts(tid), rob->numFreeEntries(tid));
    }

    // 标记本阶段是活动的
    if (wroteToTimeBuffer) {
        DPRINTF(Activity, "Activity This Cycle.\n");
        cpu->activityThisCycle();
    }

    // 尝试改变commit阶段的状态
    updateStatus();
}
```

## commit 函数

如上面所说，整个执行过程中，最重要的就是这个 commit 函数，下面对这个 commit 函数进行解析：

```cpp
void
Commit::commit()
{
    // 如果工作在全系统模式下，触发对中断的获取
    if (FullSystem) {
        if (cpu->checkInterrupts(0))
            propagateInterrupt();
    }
    // 如果我们工作在SE模式下，interrupt == NoFault 应该是成立的

    // 首先处理是否有流水线排空情况
    std::list<ThreadID>::iterator threads = activeThreads->begin();
    std::list<ThreadID>::iterator end = activeThreads->end();

    // 记录产生流水线排空的线程数
    int num_squashing_threads = 0;

    while (threads != end) {
        ThreadID tid = *threads++;

        // trapSquash 先前被设置
        // 在先前的异常触发了清空
        if (trapSquash[tid]) {
            assert(!tcSquash[tid]);
            // 处理这个清空，在这之中会调用 squashall 来清空 tid 相关的所有指令
            squashFromTrap(tid);

            // 如果执行了退出的系统调用或者不能往下进行
            // 则调度线程退出事件并进行退出
            if (cpu->isThreadExiting(tid))
                cpu->scheduleThreadExitEvent(tid);
        } else if (tcSquash[tid]) {
            assert(commitStatus[tid] != TrapPending);
            // 处理这个清空，在这之中会调用 squashall 来清空 tid 相关的所有指令
            squashFromTC(tid);
        } else if (commitStatus[tid] == SquashAfterPending) {
            // 由 SquashAfter 引起的清空，SquashAfter 是由 commitInsts 调用引起的
            squashFromSquashAfter(tid);
        }

        // 处理正常指令带来的流水线清空
        // 先前指令触发了清空 && 当前不在处理异常 && 待清空的序列号 <= 最年轻的序列号
        if (fromIEW->squash[tid] &&
            commitStatus[tid] != TrapPending &&
            fromIEW->squashedSeqNum[tid] <= youngestSeqNum[tid]) {

            // 分支预测错误带来的清空
            if (fromIEW->mispredictInst[tid]) {
                DPRINTF(Commit,
                    "[tid:%i] Squashing due to branch mispred "
                    "PC:%#x [sn:%llu]\n",
                    tid,
                    fromIEW->mispredictInst[tid]->pcState().instAddr(),
                    fromIEW->squashedSeqNum[tid]);
            } else {
                // 违反内存序带来的清空
                DPRINTF(Commit,
                    "[tid:%i] Squashing due to order violation [sn:%llu]\n",
                    tid, fromIEW->squashedSeqNum[tid]);
            }

            DPRINTF(Commit, "[tid:%i] Redirecting to PC %#x\n",
                    tid, *fromIEW->pc[tid]);

            // 将当前 commit 的状态设置为正在处理清空
            commitStatus[tid] = ROBSquashing;

            // 将 squashed_inst 设置为造成清空指令的序列号
            InstSeqNum squashed_inst = fromIEW->squashedSeqNum[tid];

            // 如果 IEW 阶段设置了连同指令本身一同被清空
            // 则 squashed_inst - 1,保证指令本身也被清空
            if (fromIEW->includeSquashInst[tid]) {
                squashed_inst--;
            }

            // 由于 squashed_inst 后续的指令都被清空
            // 于是当前线程最年轻的序列号就是 squashed_inst
            youngestSeqNum[tid] = squashed_inst;

            // 告知 ROB 开始清空
            rob->squash(squashed_inst, tid);
            // 表示对 ROB 进行了相关的改变
            changedROBNumEntries[tid] = true;

            // 向前告知当前线程最后一条被提交的指令号
            toIEW->commitInfo[tid].doneSeqNum = squashed_inst;
            // 向前告知当前阶段触发了清空
            toIEW->commitInfo[tid].squash = true;

            // 向前告知当前阶段有在处理清空
            toIEW->commitInfo[tid].robSquashing = true;

            // 向前告知产生清空的是哪条指令
            toIEW->commitInfo[tid].mispredictInst =
                fromIEW->mispredictInst[tid];
            // 向前告知当前分支是否发生
            toIEW->commitInfo[tid].branchTaken =
                fromIEW->branchTaken[tid];

            // 从 ROB 中返回 squashed_inst 这个序列号对应的指令
            // 可能是：
            //     造成 squashed 的指令
            //     造成 squashed 的指令的前一条指令，fromIEW->includeSquashInst[tid] 设置的情况下
            //     NULL， fromIEW->includeSquashInst[tid] 设置的情况下，squashed_inst--后 ROB 中可能不存在对应的指令
            toIEW->commitInfo[tid].squashInst =
                                    rob->findInst(tid, squashed_inst);
            if (toIEW->commitInfo[tid].mispredictInst) {
                // 无条件分支永远发生，只不过刚开始可能预测会出错
                if (toIEW->commitInfo[tid].mispredictInst->isUncondCtrl()) {
                     toIEW->commitInfo[tid].branchTaken = true;
                }
                ++stats.branchMispredicts;
            }

            // 向前传递实际正确取指的pc
            set(toIEW->commitInfo[tid].pc, fromIEW->pc[tid]);
        }

        // 如果当前线程正在进行清空，增加清空流水线的指令数
        if (commitStatus[tid] == ROBSquashing) {
            num_squashing_threads++;
        }
    }

    // 前面这部分总体而言主要在判断条件触发流水线的清空
    // 但是这些清空不一定在一个时钟周期内完成
    // 因此如果发现前面的代码有在处理清空，设置 _nextStatus 为 Active
    // 保证下个时钟周期 commit 阶段继续工作来处理清空
    if (num_squashing_threads) {
        _nextStatus = Active;
    }

    // 如果不是每个硬件线程都在处理清空
    if (num_squashing_threads != numThreads) {
        // 从 rename 阶段获取新的指令插入到 ROB 中
        getInsts();

        // 尝试进行提交
        commitInsts();
    }

    // 对当前活动的线程进行遍历
    threads = activeThreads->begin();

    // 继续向前面阶段传递一些信息
    while (threads != end) {
        ThreadID tid = *threads++;

        if (changedROBNumEntries[tid]) {
            // 向前面阶段告知这个阶段使用了 ROB，可能产生了一些空余空间
            toIEW->commitInfo[tid].usedROB = true;
            // 将空余空间的数目向前传递
            toIEW->commitInfo[tid].freeROBEntries = rob->numFreeEntries(tid);

            wroteToTimeBuffer = true;
            changedROBNumEntries[tid] = false;
            if (rob->isEmpty(tid))
                checkEmptyROB[tid] = true;
        }

        // 在满足三个条件下设置 ROB 为空，暂不明白这三个条件是什么
        if (checkEmptyROB[tid] && rob->isEmpty(tid) &&
            !iewStage->hasStoresToWB(tid) && !committedStores[tid]) {
            checkEmptyROB[tid] = false;
            toIEW->commitInfo[tid].usedROB = true;
            toIEW->commitInfo[tid].emptyROB = true;
            toIEW->commitInfo[tid].freeROBEntries = rob->numFreeEntries(tid);
            wroteToTimeBuffer = true;
        }

    }
}
```

## squashAll 函数

`squashAll` 在 `squashFromTrap`、`squashFromTC`、`squashFromSquashAfter` 中都有调用，下详细解释：

```cpp
void
Commit::squashAll(ThreadID tid)
{
    // 不管 ROB 是否为空，都找到一个最小的序列号能够将整个 ROB 清空
    InstSeqNum squashed_inst = rob->isEmpty(tid) ?
        lastCommitedSeqNum[tid] : rob->readHeadInst(tid)->seqNum - 1;

    // 将最年轻的序列号(离目前为止最近的序列号)更新为离现在最近提交的序列号
    youngestSeqNum[tid] = lastCommitedSeqNum[tid];

    // 开始标记清空
    rob->squash(squashed_inst, tid);
    changedROBNumEntries[tid] = true;

    // 向前告知当前线程最后一条被提交的指令号
    toIEW->commitInfo[tid].doneSeqNum = squashed_inst;
    // 向前传递当前阶段触发了清空与正在处理清空
    toIEW->commitInfo[tid].squash = true;
    toIEW->commitInfo[tid].robSquashing = true;

    // 由于是全部的清空，因此没有显示的导致清空的指令
    toIEW->commitInfo[tid].mispredictInst = NULL;
    toIEW->commitInfo[tid].squashInst = NULL;

    set(toIEW->commitInfo[tid].pc, pc[tid]);
}
```

## getInsts 函数

```cpp
void
Commit::getInsts()
{
    DPRINTF(Commit, "Getting instructions from Rename stage.\n");

    // 从 Rename 阶段提前获取指令，插入到 ROB
    int insts_to_process = std::min((int)renameWidth, fromRename->size);

    for (int inst_num = 0; inst_num < insts_to_process; ++inst_num) {
        const DynInstPtr &inst = fromRename->insts[inst_num];
        ThreadID tid = inst->threadNumber;

        // 当前指令不是清空指令，且当前线程并不在处理清空(假如正在处理清空，插进去也被清空了)
        // 且当前线程并不在处理异常
        if (!inst->isSquashed() &&
            commitStatus[tid] != ROBSquashing &&
            commitStatus[tid] != TrapPending) {
            changedROBNumEntries[tid] = true;

            DPRINTF(Commit, "[tid:%i] [sn:%llu] Inserting PC %s into ROB.\n",
                    tid, inst->seqNum, inst->pcState());

            rob->insertInst(inst);

            assert(rob->getThreadEntries(tid) <= rob->getMaxEntries(tid));

            youngestSeqNum[tid] = inst->seqNum;
        } else {
            // 这些指令应该不会直接被略过，Rename阶段会有相应的判断逻辑
            assert(commitStatus[tid] != ROBSquashing);
            assert(commitStatus[tid] != TrapPending);
            DPRINTF(Commit, "[tid:%i] [sn:%llu] "
                    "Instruction PC %s was squashed, skipping.\n",
                    tid, inst->seqNum, inst->pcState());
        }
    }
}
```

## commitInsts 函数

commitInsts 是进行 commit 的核心函数。

```cpp
void
Commit::commitInsts()
{

    DPRINTF(Commit, "Trying to commit instructions in the ROB.\n");

    // 记录提交指令的条数
    unsigned num_committed = 0;

    DynInstPtr head_inst;

    // 在设置的每个时钟周期的最多提交数目内尽可能多的进行提交
    while (num_committed < commitWidth) {

        // 获取进行提交的线程，这里获得的线程是由设置的 SMTFetchPolicy 决定的
        ThreadID commit_thread = getCommittingThread();

        // 在 SE 模式下由于没有中断，可能不会进入到这个 if
        if (interrupt != NoFault) {
            // 硬件事务内存要推迟中断，这里直接清空不做处理
            // 这里的推迟是怎么做的暂时不清楚
            if (executingHtmTransaction(commit_thread)) {
                cpu->clearInterrupts(0);
                toIEW->commitInfo[0].clearInterrupt = true;
                interrupt = NoFault;
                avoidQuiesceLiveLock = true;
            } else {
                // 处理异常，执行相关的处理，但是不建模时序，建模时序在后面进行
                handleInterrupt();
            }
        }

        // 如果获取不到能够进行commit的线程，直接返回
        if (commit_thread == -1 || !rob->isHeadReady(commit_thread))
            break;
            
        // 拿到最头部的指令
        head_inst = rob->readHeadInst(commit_thread);

        ThreadID tid = head_inst->threadNumber;

        assert(tid == commit_thread);

        DPRINTF(Commit,
                "Trying to commit head instruction, [tid:%i] [sn:%llu]\n",
                tid, head_inst->seqNum);

        // 如果最头部的指令是被淘汰的，直接从 ROB 中移除就是了
        if (head_inst->isSquashed()) {

            DPRINTF(Commit, "Retiring squashed instruction from "
                    "ROB.\n");

            rob->retireHead(commit_thread);

            ++stats.commitSquashedInsts;
            // Notify potential listeners that this instruction is squashed
            ppSquash->notify(head_inst);

            // Record that the number of ROB entries has changed.
            changedROBNumEntries[tid] = true;
        } else {
            // 如果不是，属于正常commit，更新pc值，这个pc值应该代表着程序commit到了哪里
            set(pc[tid], head_inst->pcState());

            // 尝试对这个头部指令进行提交
            bool commit_success = commitHead(head_inst, num_committed);

            if (commit_success) {
                // 成功commit，更新相关的统计数据
                ++num_committed;
                cpu->commitStats[tid]
                    ->committedInstType[head_inst->opClass()]++;
                stats.committedInstType[tid][head_inst->opClass()]++;
                ppCommit->notify(head_inst);

                // 硬件事务内存相关

                if (head_inst->isHtmStart())
                    htmStarts[tid]++;

                if (head_inst->inHtmTransactionalState()) {
                    assert(executingHtmTransaction(tid));
                } else {
                    assert(!executingHtmTransaction(tid));
                }

                if (head_inst->isHtmStop())
                    htmStops[tid]++;

                changedROBNumEntries[tid] = true;

                // 更新最后完成指令的信息，并向前传递
                toIEW->commitInfo[tid].doneSeqNum = head_inst->seqNum;

                if (tid == 0)
                    canHandleInterrupts = !head_inst->isDelayedCommit();

                // at this point store conditionals should either have
                // been completed or predicated false
                assert(!head_inst->isStoreConditional() ||
                       head_inst->isCompleted() ||
                       !head_inst->readPredicate());

                // 更新相关的寄存器
                head_inst->updateMiscRegs();

                // checker cpu 相关
                if (cpu->checker) {
                    cpu->checker->verify(head_inst);
                }

                cpu->traceFunctions(pc[tid]->instAddr());

                head_inst->staticInst->advancePC(*pc[tid]);

                // 更新最后 commit 的指令
                lastCommitedSeqNum[tid] = head_inst->seqNum;

                // If this is an instruction that doesn't play nicely with
                // others squash everything and restart fetch
                if (head_inst->isSquashAfter())
                    squashAfter(tid, head_inst);

                // 切换 cpu 时候的排空相关
                if (drainPending) {
                    if (pc[tid]->microPC() == 0 && interrupt == NoFault &&
                        !thread[tid]->trapPending) {
                        
                        DPRINTF(Drain, "Draining: %i:%s\n", tid, *pc[tid]);
                        squashAfter(tid, head_inst);
                        cpu->commitDrained(tid);
                        drainImminent = true;
                    }
                }

                
                // CISC 相关，是对于微指令边界的判断
                bool onInstBoundary = !head_inst->isMicroop() ||
                                      head_inst->isLastMicroop() ||
                                      !head_inst->isDelayedCommit();

                if (onInstBoundary) {
                    int count = 0;
                    Addr oldpc;
                    // Make sure we're not currently updating state while
                    // handling PC events.
                    assert(!thread[tid]->noSquashFromTC &&
                           !thread[tid]->trapPending);
                    do {
                        oldpc = pc[tid]->instAddr();
                        thread[tid]->pcEventQueue.service(
                                oldpc, thread[tid]->getTC());
                        count++;
                    } while (oldpc != pc[tid]->instAddr());
                    if (count > 1) {
                        DPRINTF(Commit,
                                "PC skip function event, stopping commit\n");
                        break;
                    }
                }

                // Check if an instruction just enabled interrupts and we've
                // previously had an interrupt pending that was not handled
                // because interrupts were subsequently disabled before the
                // pipeline reached a place to handle the interrupt. In that
                // case squash now to make sure the interrupt is handled.
                //
                // If we don't do this, we might end up in a live lock
                // situation.
                if (!interrupt && avoidQuiesceLiveLock &&
                    onInstBoundary && cpu->checkInterrupts(0))
                    squashAfter(tid, head_inst);
            } else {
                // 如果提交头部指令失败，直接停止提交
                DPRINTF(Commit, "Unable to commit head instruction PC:%s "
                        "[tid:%i] [sn:%llu].\n",
                        head_inst->pcState(), tid ,head_inst->seqNum);
                break;
            }// if (commit_success)
        }
    }

    // 更新相关的统计数据
    DPRINTF(CommitRate, "%i\n", num_committed);
    stats.numCommittedDist.sample(num_committed);

    if (num_committed == commitWidth) {
        stats.commitEligibleSamples++;
    }
}
```

## commitHead 函数

```cpp
bool
Commit::commitHead(const DynInstPtr &head_inst, unsigned inst_num)
{
    assert(head_inst);

    // 获取到线程号
    ThreadID tid = head_inst->threadNumber;

    // 如果这条指令还没被执行
    if (!head_inst->isExecuted()) {
        // Make sure we are only trying to commit un-executed instructions we
        // think are possible.
        assert(head_inst->isNonSpeculative() || head_inst->isStoreConditional()
               || head_inst->isReadBarrier() || head_inst->isWriteBarrier()
               || head_inst->isAtomic()
               || (head_inst->isLoad() && head_inst->strictlyOrdered()));

        DPRINTF(Commit,
                "Encountered a barrier or non-speculative "
                "instruction [tid:%i] [sn:%llu] "
                "at the head of the ROB, PC %s.\n",
                tid, head_inst->seqNum, head_inst->pcState());

        if (inst_num > 0 || iewStage->hasStoresToWB(tid)) {
            DPRINTF(Commit,
                    "[tid:%i] [sn:%llu] "
                    "Waiting for all stores to writeback.\n",
                    tid, head_inst->seqNum);
            return false;
        }

        toIEW->commitInfo[tid].nonSpecSeqNum = head_inst->seqNum;

        // Change the instruction so it won't try to commit again until
        // it is executed.
        head_inst->clearCanCommit();

        if (head_inst->isLoad() && head_inst->strictlyOrdered()) {
            DPRINTF(Commit, "[tid:%i] [sn:%llu] "
                    "Strictly ordered load, PC %s.\n",
                    tid, head_inst->seqNum, head_inst->pcState());
            toIEW->commitInfo[tid].strictlyOrdered = true;
            toIEW->commitInfo[tid].strictlyOrderedLoad = head_inst;
        } else {
            ++stats.commitNonSpecStalls;
        }

        return false;
    }

    // Check if the instruction caused a fault.  If so, trap.
    Fault inst_fault = head_inst->getFault();

    // hardware transactional memory
    // if a fault occurred within a HTM transaction
    // ensure that the transaction aborts
    if (inst_fault != NoFault && head_inst->inHtmTransactionalState()) {
        // There exists a generic HTM fault common to all ISAs
        if (!std::dynamic_pointer_cast<GenericHtmFailureFault>(inst_fault)) {
            DPRINTF(HtmCpu, "%s - fault (%s) encountered within transaction"
                            " - converting to GenericHtmFailureFault\n",
            head_inst->staticInst->getName(), inst_fault->name());
            inst_fault = std::make_shared<GenericHtmFailureFault>(
                head_inst->getHtmTransactionUid(),
                HtmFailureFaultCause::EXCEPTION);
        }
        // If this point is reached and the fault inherits from the HTM fault,
        // then there is no need to raise a new fault
    }

    // Stores mark themselves as completed.
    if (!head_inst->isStore() && inst_fault == NoFault) {
        head_inst->setCompleted();
    }

    if (inst_fault != NoFault) {
        DPRINTF(Commit, "Inst [tid:%i] [sn:%llu] PC %s has a fault\n",
                tid, head_inst->seqNum, head_inst->pcState());

        if (iewStage->hasStoresToWB(tid) || inst_num > 0) {
            DPRINTF(Commit,
                    "[tid:%i] [sn:%llu] "
                    "Stores outstanding, fault must wait.\n",
                    tid, head_inst->seqNum);
            return false;
        }

        head_inst->setCompleted();

        // If instruction has faulted, let the checker execute it and
        // check if it sees the same fault and control flow.
        if (cpu->checker) {
            // Need to check the instruction before its fault is processed
            cpu->checker->verify(head_inst);
        }

        assert(!thread[tid]->noSquashFromTC);

        // Mark that we're in state update mode so that the trap's
        // execution doesn't generate extra squashes.
        // todo: Don't want squash while processing fault?
        thread[tid]->noSquashFromTC = true;

        // Execute the trap.  Although it's slightly unrealistic in
        // terms of timing (as it doesn't wait for the full timing of
        // the trap event to complete before updating state), it's
        // needed to update the state as soon as possible.  This
        // prevents external agents from changing any specific state
        // that the trap need.
        // this execute trap.
        cpu->trap(inst_fault, tid,
                  head_inst->notAnInst() ? nullStaticInstPtr :
                      head_inst->staticInst);

        // Exit state update mode to avoid accidental updating.
        thread[tid]->noSquashFromTC = false;

        commitStatus[tid] = TrapPending;

        DPRINTF(Commit,
            "[tid:%i] [sn:%llu] Committing instruction with fault\n",
            tid, head_inst->seqNum);
        if (head_inst->traceData) {
            // We ignore ReExecution "faults" here as they are not real
            // (architectural) faults but signal flush/replays.
            if (debug::ExecFaulting
                && dynamic_cast<ReExec*>(inst_fault.get()) == nullptr) {

                head_inst->traceData->setFaulting(true);
                head_inst->traceData->setFetchSeq(head_inst->seqNum);
                head_inst->traceData->setCPSeq(thread[tid]->numOp);
                head_inst->traceData->dump();
            }
            delete head_inst->traceData;
            head_inst->traceData = NULL;
        }

        // Generate trap squash event.
        // Modeling the timing of traps here.
        generateTrapEvent(tid, inst_fault);
        return false;
    }

    updateComInstStats(head_inst);

    DPRINTF(Commit,
            "[tid:%i] [sn:%llu] Committing instruction with PC %s\n",
            tid, head_inst->seqNum, head_inst->pcState());
    if (head_inst->traceData) {
        head_inst->traceData->setFetchSeq(head_inst->seqNum);
        head_inst->traceData->setCPSeq(thread[tid]->numOp);
        head_inst->traceData->dump();
        delete head_inst->traceData;
        head_inst->traceData = NULL;
    }
    if (head_inst->isReturn()) {
        DPRINTF(Commit,
                "[tid:%i] [sn:%llu] Return Instruction Committed PC %s \n",
                tid, head_inst->seqNum, head_inst->pcState());
    }

    // Update the commit rename map
    for (int i = 0; i < head_inst->numDestRegs(); i++) {
        renameMap[tid]->setEntry(head_inst->flattenedDestIdx(i),
                                 head_inst->renamedDestIdx(i));
    }

    // hardware transactional memory
    // the HTM UID is purely for correctness and debugging purposes
    if (head_inst->isHtmStart())
        iewStage->setLastRetiredHtmUid(tid, head_inst->getHtmTransactionUid());

    // Finally clear the head ROB entry.
    rob->retireHead(tid);


    // If this was a store, record it for this cycle.
    if (head_inst->isStore() || head_inst->isAtomic())
        committedStores[tid] = true;

    // Return true to indicate that we have committed an instruction.
    return true;
}
```
