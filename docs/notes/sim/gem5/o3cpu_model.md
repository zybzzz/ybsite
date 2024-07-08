# O3CPU model

这篇文章主要是 o3cpu 的杂记，o3cpu 太过复杂，因此只挑一部分对我有用的进行记录。

## rename 阶段

rename 阶段的实现在[这篇文章](../gem5src/cpu/o3/rename.md)中找到。

## IEW 阶段

IEW 阶段可以参考[这篇文章](../gem5src/cpu/o3/iew.md)。

## Commit 阶段

commit 的实现在[这篇文章](../gem5src/cpu/o3/commit.md)中找到。

### ROB 实现

重排序缓冲的实现可以在[这篇文章](../gem5src/cpu/o3/rob.md)中找到。

## 时间计算

在 o3 的场景下，cpu 中的时钟周期计算并不依靠 `updateCycleCounters`，因为 BaseCPU 中的监测点并没有进行设置。通过观察，各类时间几乎都是通过当前时间与 `lastRunningCycle` 的差值来计算得到的。

首先对于 cpu 本身的时钟周期，在 tick 函数中，直接有 `++baseStats.numCycles`，~~因此最终得到的 `numCycles` 统计数据实际上代表的就是 cpu 的活动时间，这个时间是不包含休眠中断的时间的，完完全全就是 cpu 在活动的时间~~之前砍死这个统计数据在计算 cpu 的活动时间，但是在后续的 `CPU::wakeCPU` 中，如果 cpu 重新激活，这个统计数据还会计算空闲的时间，因此这个时间完全就是整个运行程序的过程执行的时间。

`CPU::activateContext` 在唤醒某个线程的时候，也会进行时钟周期的计算，`cpuStats.quiesceCycles += cycles` 进行了这样的计算，实际上就是一直在累积**每次重新开始到上次禁止之间的时间差**。在这个方法中同时也会激活线程，把线程加入到 `activeThreads` 中，同时激活相关线程的 fetch 和 commit 阶段。

`CPU::suspendContext` 中无条件将指定的线程移出 `activeThreads`，并且将并将相关线程的 fetch 和 commit 都暂停掉。如果 cpu 中的活动线程数为 0 了，表示 cpu 可以休眠了，所以将`lastRunningCycle` 时间设置在当前停止时刻，这样导致下次 activate 计算的时候计算的差值代表着静止的时间，同时取消对于 tick 事件的调度。

`CPU::haltContext` 中同理，因为线程无法向下推进，这个线程直接被移除。

`CPU::takeOverFrom` 在执行的时候，也会将 `lastRunningCycle` 的时间设置为当前的时间。

## 其他api

1. `CPU::wakeup` 用来唤醒单个线程，在其中会调用 `CPU::wakeCPU`。
2. `CPU::wakeCPU` 检测 cpu 是否被激活，没被激活会唤醒 cpu，调度 tick 事件。
