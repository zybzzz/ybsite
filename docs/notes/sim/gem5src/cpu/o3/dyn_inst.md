# dyn_inst

dyn_inst 实际上维护了 o3 指令执行时候的线程状态，这里主要记录某些状态什么时候被设置，什么时候被取消。

## setInROB

在 ROB::insertInst 的时候被设置，在 ROB::retireHead 中被消除。

## setCompleted

在Commit::commitHead(非store)中和 lsq(store) 被设置。

## setExecuted

在 IEW 阶段的各个组件中设置。

## setCanCommit

1. 在 IEW 阶段的各个组件中设置，暂时不明白和 setExecuted 之间存在着什么关系。
2. 在 ROB 中标记排空的时候设置。
3. Commit::markCompletedInsts中设置，但是我认为这部分没什么用，是在重复检查。

## setAtCommit

完全在 IEW 各个阶段中设置，目的未知。

## setCommitted

ROB::retireHead 中设置。

## setSquashed

在多个阶段均有设置，除了预测错误之外不清楚有什么原因需要设置这个。