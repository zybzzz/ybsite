# ROB 实现

o3 中的 ROB 实现是一个比较简单的 ROB 的实现，在 ROB 的内部并没有复杂逻辑的实现，而是提供了比较基本的结构，使 ROB 能够配合 Commit 实现一些复杂的逻辑。下面对 ROB 中的一些关键点进行记录。

## 公有成员

除了公有的函数之外，ROB 还有一个公有的成员使外部能够访问。

他们的解释如下：

```cpp
public:
    // 永远指向所有 ROB 中最年轻的一条指令
    InstIt tail;

    // 永远指向所有 ROB 中最年老的一条指令
    InstIt head;

public:
    // 返回正在 ROB 中的指令数目，即当前所有硬件线程的 ROB 中数目的总和
    int numInstsInROB;

    // 这是一条虚拟指令，在某个线程的 ROB 为空的时候回返回这条虚拟指令
    DynInstPtr dummyInst;
```

## 初始化与每个线程的最大 ROB 容量

在构造函数中，ROB 中有 4 个成员从 python 配置文件接收参数，它们分别是：

1. robPolicy：接收自 params.smtROBPolicy，这个主要与 ROB 中最大指令的数目有关，**与提交策略无关**。
2. numEntries：接收自 params.numROBEntries，所有 ROB 合起来能够达到的最大上限容量。
3. squashWidth：接收自 params.squashWidth，单个周期内能够清空的最大指令数。
4. numThreads：接收自 params.numThreads，cpu 内的硬件硬件线程数。

根据 robPolicy 中不同的策略，单个硬件线程 ROB 中能够容纳的最大数目策略如下：

1. SMTQueuePolicy::Dynamic：不限制单个线程 ROB 可容纳的最大数目，但是所有的加起来应当不能超过总的 ROB 可容纳的最大数目。
2. SMTQueuePolicy::Partitioned：均匀分配，单个线程最大的 ROB 容纳数等于 $numEntries / number \, of \, threads$，即最大数目均分到各个线程上。
3. SMTQueuePolicy::Threshold：单个线程的最大 ROB 容纳数等于 params.smtROBThreshold 的设定值，但是总数应该还是不能超过总的 ROB 可容纳的数目。

## 关键方法

有以下几个关键的方法：

- insertInst：只是简单的将指令插入到 list 当中，并更新相关的指令状态。如果必要的话，可能还会更新首尾指针。
- retireHead：从指定 tid 的 ROB 中退役一条指令，**这里确实将一条指令从 list 中进行移除**，更新指令的相关状态，更新 ROB 的 head 信息。
- isHeadReady：确定某个 ROB 的头部能否被提交，这需要 ROB 头部指令的 readyToCommit 状态被设置才返回 true。
- doSquash：进行淘汰操作，**注意这个操作只是设定指令的状态为需要淘汰状态**，而没有将指令从 ROB 中移除，一次操作能够处理的最多指令为 squashWidth 条指令。
- squash：根据传入的序列号进行淘汰操作，在这里会设置 ROB 状态为 ROBSquashing，实际上会调用 doSquash。
