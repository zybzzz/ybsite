# gem5 o3 中断处理 risc-v 为例

在乱序乱序超标量的情况下，中断处理实现的是精确中断，等于说是在中断发生的一颗，处理器开始停止取指，然后等待中断处理完了之后才开始恢复取指。

## 检查中断

```cpp
if (FullSystem) {
    // Check if we have a interrupt and get read to handle it
    if (cpu->checkInterrupts(0))
        propagateInterrupt();
}

void
Commit::propagateInterrupt()
{
    // Don't propagate intterupts if we are currently handling a trap or
    // in draining and the last observable instruction has been committed.
    if (commitStatus[0] == TrapPending || interrupt || trapSquash[0] ||
            tcSquash[0] || drainImminent)
        return;

    // Process interrupts if interrupts are enabled, not in PAL
    // mode, and no other traps or external squashes are currently
    // pending.
    // @todo: Allow other threads to handle interrupts.

    // Get any interrupt that happened
    interrupt = cpu->getInterrupts();

    // Tell fetch that there is an interrupt pending.  This
    // will make fetch wait until it sees a non PAL-mode PC,
    // at which point it stops fetching instructions.
    if (interrupt != NoFault)
        toIEW->commitInfo[0].interruptPending = true;
}

```

实际上是在全系统模式下检查中断，同时不同体系结构检查中断具有不同的方法，具体的实现实现在 `arch/{arch}/interrupt.hh` 下。对于 riscv 而言，检查中断实际上就是在检查 mie/mip 寄存器，外设想要触发中断可以调用中断控制器中的 post 方法，将中断记录到 mip 中，等待 cpu 慢慢处理，因此即使有多个中断，也是能处理的。同时上面 cpu 获取到中断的条件也非常苛刻：

1. 当前不能在处理异常
2. 当前不能已经有等待处理的中断
3. 当前不能已经在异常squash状态

只有在这种情况下,cpu 才开始监测到中断，并设置 `interruptPending` 标志让前端停止取指。

## 中断处理

```cpp
void
Commit::handleInterrupt()
{
    // Verify that we still have an interrupt to handle
    if (!cpu->checkInterrupts(0)) {
        DPRINTF(Commit, "Pending interrupt is cleared by requestor before "
                "it got handled. Restart fetching from the orig path.\n");
        toIEW->commitInfo[0].clearInterrupt = true;
        interrupt = NoFault;
        avoidQuiesceLiveLock = true;
        return;
    }

    // Wait until all in flight instructions are finished before enterring
    // the interrupt.
    if (canHandleInterrupts && cpu->instList.empty()) {
        // Squash or record that I need to squash this cycle if
        // an interrupt needed to be handled.
        DPRINTF(Commit, "Interrupt detected.\n");

        // Clear the interrupt now that it's going to be handled
        // toIEW->commitInfo[0].clearInterrupt = true;

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

        cpu->mmu->setOldPriv(cpu->getContext(0));

        thread[0]->noSquashFromTC = false;

        commitStatus[0] = TrapPending;

        interrupt = NoFault;

        // Generate trap squash event.
        generateTrapEvent(0, interrupt);

        avoidQuiesceLiveLock = false;
    } else {
        DPRINTF(Commit, "Interrupt pending: instruction is %sin "
                "flight, ROB is %sempty\n",
                canHandleInterrupts ? "not " : "",
                cpu->instList.empty() ? "" : "not " );
    }
}

```

可以看到这边的中断处理是首先再度监测中断是否存在，如果不存在了就不需要处理中断了，同时告知 `clearInterrupt` 可以重新开始取指了。如果中断仍然存在，且当前处理器上的指令都被提交完了，就开始设置中断的事件开始触发中断的处理了。其他就跟执行异常没区别了。