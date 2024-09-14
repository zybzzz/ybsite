# 对于 commit 阶段的补充

这篇文章主要记录对于 commit 阶段的补充，主要包括对 squash 的处理流程，还有一些其他的杂项。

## squash 的处理

造成 squash 的原因有 3 种可能：

1. 指令触发的异常造成的 squash.
2. 预测性指令的错误造成的 squash.
3. 中断造成的 squash.

这三者在 commit 阶段的实现中具有不同的优先级，从代码代码中明显可以看出的是中断的处理优先级是最低的。

### 中断的处理(中断带来的 squash)

这里的中断来自 cpu 外部的中断，其在 commit 阶段中的处理是首先收集中断信息，在条件合适的时候才进行中断的处理。对于中断信息的收集在 commit 函数中：

```cpp
    if (FullSystem) {
        // Check if we have a interrupt and get read to handle it
        if (cpu->checkInterrupts(0))
            propagateInterrupt();
    }
```

这里调用的 `propagateInterrupt` 就是在收集中断的信息：

```cpp
void
Commit::propagateInterrupt()
{
    if (commitStatus[0] == TrapPending || interrupt || trapSquash[0] || tcSquash[0] || drainImminent)
        return;

    interrupt = cpu->getInterrupts();

    if (interrupt != NoFault)
        toIEW->commitInfo[0].interruptPending = true;
}
```

可以看到收集中断信号的条件已经十分苛刻：

1. 当前不能已经在处理中断或者 trap。
2. 当前不能已经在处理一个中断。
3. 当前不能已经在进行某个 trap 的清空。
4. 当前不能已经在处理某个 tc 清空。
5. 当前不能处在与 drain 相关的操作中。

1、2、3 条件都是先前的 commit 阶段已经满足的。而 4 中的 tcSquash 是外部状态变更导致的清空，可能是在多核的条件下满足的，这点暂时不清晰。总之从收中断的信号开始条件就比较苛刻。

对于中断的处理在 commitInsts 中：

```cpp
        if (interrupt != NoFault) {
            // If inside a transaction, postpone interrupts
            if (executingHtmTransaction(commit_thread)) {
                cpu->clearInterrupts(0);
                toIEW->commitInfo[0].clearInterrupt = true;
                interrupt = NoFault;
                avoidQuiesceLiveLock = true;
            } else {
                handleInterrupt();
            }
        }

```

其中的 `handleInterrupt` 用来进行终端的处理：

```cpp
void
Commit::handleInterrupt()
{
    // 因为某些原因中断信号消失了 
    // 设置 avoidQuiesceLiveLock 变量
    // 这个变量表示中断的推迟
    if (!cpu->checkInterrupts(0)) {
        DPRINTF(Commit,
                "Pending interrupt is cleared by requestor before "
                "it got handled. Restart fetching from the orig path.\n");
        toIEW->commitInfo[0].clearInterrupt = true;
        interrupt = NoFault;
        avoidQuiesceLiveLock = true;
        return;
    }

    // 满足两个条件才能处理中断
    if (canHandleInterrupts && cpu->instList.empty()) {
        // Squash or record that I need to squash this cycle if
        // an interrupt needed to be handled.
        DPRINTF(Commit, "Interrupt detected.\n");

        // Clear the interrupt now that it's going to be handled
        toIEW->commitInfo[0].clearInterrupt = true;

        assert(!thread[0]->noSquashFromTC);
        thread[0]->noSquashFromTC = true;

        if (cpu->checker) {
            cpu->checker->handlePendingInt();
        }

        // CPU will handle interrupt. Note that we ignore the local copy of
        // interrupt. This is because the local copy may no longer be the
        // interrupt that the interrupt controller thinks is being handled.
        if (cpu->difftestEnabled()) {
            cpu->difftestRaiseIntr(cpu->getInterruptsNO() | (1ULL << 63));
        }

        DPRINTF(CommitTrace, "Handle interrupt No.%lx\n", cpu->getInterruptsNO() | (1ULL << 63));
        cpu->processInterrupts(cpu->getInterrupts());


        thread[0]->noSquashFromTC = false;

        commitStatus[0] = TrapPending;

        interrupt = NoFault;

        // Generate trap squash event.
        // 正常的处理流程，最后产生一个 trap event，所以从程序实现上他还是借用了 trap 的实现
        generateTrapEvent(0, interrupt);

        avoidQuiesceLiveLock = false;
    } else {
        DPRINTF(Commit,
                "Interrupt pending: instruction is %sin "
                "flight, ROB is %sempty\n",
                canHandleInterrupts ? "not " : "", cpu->instList.empty() ? "" : "not ");
    }
}

```

这里有比较关键的一点也是在 commit 阶段进行处理的时候频繁出现的一点就是代码：

```cpp
thread[0]->noSquashFromTC = true;
```

在任何情况下这个变量可能都是 false 的情况存在，表示某种情况下产生 tcsquash 中断，这是在 o3/threadcontext.cc 中 set操作的时候会进行相关的判断，一旦这个选项设置成 false，很可能在处理过程中调用 cpu::generatetcsquash，进而导致 tcsquash。因此在处理清空相关的操作的时候 commit 在频频设置这个变量。

另外注意到处理中断的两个条件：

1. 所有的指令都被提交。
2. canHandleInterrupts 被设置。

第一点很好理解。对于第二点后续代码中有 `canHandleInterrupts = !head_inst->isDelayedCommit();`,经过相关的检查发现 amo 操作可能会设置这个标记。同时如果存在这个标记的指令会影响取指。

### 其他

剩下的就是异常和预测性指令带来的 squash。对于每条指令提交的时候都会分别检查,trap\tc\squashafter，符合其中一个就进行清空。随后进行对指令的提交，如果预测性指令出错，进行指令的清空。简而言之就是有 trap 等信号的时候导致 trap squash，其他情况正常处理指令产生 trap squash 和 正常指令的 squash。
