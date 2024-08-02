# tage_base

这是 TAGE 类型的分支预测器使用的基础类，主要讲解一些它的关注点。

## 配置文件

配置文件中的参数，解析如下：

```python
class TAGEBase(SimObject):
    type = "TAGEBase"
    cxx_class = "gem5::branch_prediction::TAGEBase"
    cxx_header = "cpu/pred/tage_base.hh"

    numThreads = Param.Unsigned(Parent.numThreads, "Number of threads")

    # 拿到指令的时候需要进行位移的位数
    # 进行路径历史记录的时候需要进行位移
    instShiftAmt = Param.Unsigned(
        Parent.instShiftAmt, "Number of bits to shift instructions by"
    )

    # 几张历史表
    nHistoryTables = Param.Unsigned(7, "Number of history tables")
    # 全局历史的最小长度
    minHist = Param.Unsigned(5, "Minimum history size of TAGE")
    # 全局历史的最大长度
    maxHist = Param.Unsigned(130, "Maximum history size of TAGE")

    # 每个表中的 tag 位数
    tagTableTagWidths = VectorParam.Unsigned(
        [0, 9, 9, 10, 10, 11, 11, 12], "Tag size in TAGE tag tables"
    )
    # log2(table size) 等于是 index 的位数
    logTagTableSizes = VectorParam.Int(
        [13, 9, 9, 9, 9, 9, 9, 9], "Log2 of TAGE table sizes"
    )
    logRatioBiModalHystEntries = Param.Unsigned(
        2,
        "Log num of prediction entries for a shared hysteresis bit "
        "for the Bimodal",
    )

    tagTableCounterBits = Param.Unsigned(3, "Number of tag table counter bits")
    tagTableUBits = Param.Unsigned(2, "Number of tag table u bits")

    # 全局历史数组的大小，对预测器可见的还是上面的大小，这里只是多分配一点的空间
    histBufferSize = Param.Unsigned(
        2097152,
        "A large number to track all branch histories(2MEntries default)",
    )

    # 记录路径历史的长度，路径地址是每次分支pc最后一位组成的历史
    pathHistBits = Param.Unsigned(16, "Path history size")
    logUResetPeriod = Param.Unsigned(
        18, "Log period in number of branches to reset TAGE useful counters"
    )
    numUseAltOnNa = Param.Unsigned(1, "Number of USE_ALT_ON_NA counters")
    initialTCounterValue = Param.Int(1 << 17, "Initial value of tCounter")
    useAltOnNaBits = Param.Unsigned(4, "Size of the USE_ALT_ON_NA counter(s)")

    maxNumAlloc = Param.Unsigned(
        1, "Max number of TAGE entries allocted on mispredict"
    )

    # List of enabled TAGE tables. If empty, all are enabled
    noSkip = VectorParam.Bool([], "Vector of enabled TAGE tables")

    # 是否投机的更新，就是还没出结果的时候就更新预测器
    speculativeHistUpdate = Param.Bool(
        True, "Use speculative update for histories"
    )

```

## 数据结构

目前我关注的数据结构是 ThreadHistory，主要是对单个线程的历史记录。

```cpp
struct ThreadHistory
{
    // Speculative path history
    // (LSB of branch address)
    // 记录了路径历史
    int pathHist;

    // Speculative branch direction
    // history (circular buffer)
    // @TODO Convert to std::vector<bool>
    // 记录了全局历史
    // 在运行时候会分配出一个 int 数组表示历史
    // 数组中的每一个 int 1 代表发生，反之不发生
    // 使用 int 是为了方便写代码表示
    uint8_t *globalHistory;

    // Pointer to most recent branch outcome
    // 指向最近的一个分支结果，即指向 globalHistory 代表最近一个分支的元素
    uint8_t* gHist;

    // Index to most recent branch outcome
    // 即记录 gHist 在 globalHistory 中的下标位置
    int ptGhist;

    // Speculative folded histories.
    // 用来计算 hash 用的
    FoldedHistory *computeIndices;
    FoldedHistory *computeTags[2];
};
```

## 类方法

### btbUpdate

只有这个方法访问到了 ThreadHistory 中 computeIndices 和 computeTags 数据结构，但是这个方法在这个项目的任何地方都没有调用。

### init

```cpp
void
TAGEBase::init()
{
    if (initialized) {
       return;
    }

    // Current method for periodically resetting the u counter bits only
    // works for 1 or 2 bits
    // Also make sure that it is not 0
    assert(tagTableUBits <= 2 && (tagTableUBits > 0));

    // we use int type for the path history, so it cannot be more than
    // its size
    assert(pathHistBits <= (sizeof(int)*8));

    // initialize the counter to half of the period
    assert(logUResetPeriod != 0);
    tCounter = initialTCounterValue;

    assert(histBufferSize > maxHist * 2);

    useAltPredForNewlyAllocated.resize(numUseAltOnNa, 0);

    for (auto& history : threadHistory) {
        history.pathHist = 0;
        // 可以看到这里每个线程的全局历史分配的是 histBufferSize 的长度
        history.globalHistory = new uint8_t[histBufferSize];
        history.gHist = history.globalHistory;
        memset(history.gHist, 0, histBufferSize);
        history.ptGhist = 0;
    }

    // histLengths 记录了每个表需要依靠的历史位的长度
    // 为什么 + 1，是因为这些东西的下标都从 1 开始
    histLengths = new int [nHistoryTables+1];

    calculateParameters();

    assert(tagTableTagWidths.size() == (nHistoryTables+1));
    assert(logTagTableSizes.size() == (nHistoryTables+1));

    // First entry is for the Bimodal table and it is untagged in this
    // implementation
    assert(tagTableTagWidths[0] == 0);

    // 虽然进行了更新，但是没什么用
    for (auto& history : threadHistory) {
        history.computeIndices = new FoldedHistory[nHistoryTables+1];
        history.computeTags[0] = new FoldedHistory[nHistoryTables+1];
        history.computeTags[1] = new FoldedHistory[nHistoryTables+1];

        initFoldedHistories(history);
    }

    const uint64_t bimodalTableSize = 1ULL << logTagTableSizes[0];
    btablePrediction.resize(bimodalTableSize, false);
    btableHysteresis.resize(bimodalTableSize >> logRatioBiModalHystEntries,
                            true);

    gtable = new TageEntry*[nHistoryTables + 1];
    buildTageTables();

    tableIndices = new int [nHistoryTables+1];
    tableTags = new int [nHistoryTables+1];
    initialized = true;
}

```

### F

这是一个哈希函数，在计算 table 的 index 的时候用来哈希用的，不管他具体实现。

### gindex 和 gtag

```cpp
// gindex computes a full hash of pc, ghist and pathHist
int
TAGEBase::gindex(ThreadID tid, Addr pc, int bank) const
{
    int index;
    int hlen = (histLengths[bank] > pathHistBits) ? pathHistBits :
                                                    histLengths[bank];
    const unsigned int shiftedPc = pc >> instShiftAmt;
    index =
        shiftedPc ^
        (shiftedPc >> ((int) abs(logTagTableSizes[bank] - bank) + 1)) ^
        threadHistory[tid].computeIndices[bank].comp ^
        F(threadHistory[tid].pathHist, hlen, bank);

    return (index & ((1ULL << (logTagTableSizes[bank])) - 1));
}


// Tag computation
uint16_t
TAGEBase::gtag(ThreadID tid, Addr pc, int bank) const
{
    int tag = (pc >> instShiftAmt) ^
              threadHistory[tid].computeTags[0][bank].comp ^
              (threadHistory[tid].computeTags[1][bank].comp << 1);

    return (tag & ((1ULL << tagTableTagWidths[bank]) - 1));
}
```

就是利用现有的数据进行一些哈希，从而计算得到 tag 和 index。

### updateGhist

```cpp
void
TAGEBase::updateGHist(uint8_t * &h, bool dir, uint8_t * tab, int &pt)
{
    if (pt == 0) {
        DPRINTF(Tage, "Rolling over the histories\n");
         // Copy beginning of globalHistoryBuffer to end, such that
         // the last maxHist outcomes are still reachable
         // through pt[0 .. maxHist - 1].
         for (int i = 0; i < maxHist; i++)
             tab[histBufferSize - maxHist + i] = tab[i];
         pt =  histBufferSize - maxHist;
         h = &tab[pt];
    }
    pt--;
    h--;
    h[0] = (dir) ? 1 : 0;
}

```

可以看到全局历史的地位是更新的历史，高位是更旧的历史。

### updateHistories

```cpp
void
TAGEBase::updateHistories(ThreadID tid, Addr branch_pc, bool taken,
                          BranchInfo* bi, bool speculative,
                          const StaticInstPtr &inst, Addr target)
{
    if (speculative != speculativeHistUpdate) {
        return;
    }
    ThreadHistory& tHist = threadHistory[tid];
    //  UPDATE HISTORIES
    //  进行相关的位移并取出路径历史
    bool pathbit = ((branch_pc >> instShiftAmt) & 1);
    //on a squash, return pointers to this and recompute indices.
    //update user history
    // 更新全局的历史
    updateGHist(tHist.gHist, taken, tHist.globalHistory, tHist.ptGhist);
    tHist.pathHist = (tHist.pathHist << 1) + pathbit;
    tHist.pathHist = (tHist.pathHist & ((1ULL << pathHistBits) - 1));

    if (speculative) {
        bi->ptGhist = tHist.ptGhist;
        bi->pathHist = tHist.pathHist;
    }

    //prepare next index and tag computations for user branchs
    // 根据全局历史更新 computeIndices computeTags 等等用于新的哈希
    for (int i = 1; i <= nHistoryTables; i++)
    {
        if (speculative) {
            // 由于这是投机的，因此要先把原来的值记录下来
            bi->ci[i]  = tHist.computeIndices[i].comp;
            bi->ct0[i] = tHist.computeTags[0][i].comp;
            bi->ct1[i] = tHist.computeTags[1][i].comp;
        }
        // 利用最新猜测的全局历史更新 computeIndices 和 computeTags
        // 用于后续的 index 和 tag 的计算
        tHist.computeIndices[i].update(tHist.gHist);
        tHist.computeTags[0][i].update(tHist.gHist);
        tHist.computeTags[1][i].update(tHist.gHist);
    }
    DPRINTF(Tage, "Updating global histories with branch:%lx; taken?:%d, "
            "path Hist: %x; pointer:%d\n", branch_pc, taken, tHist.pathHist,
            tHist.ptGhist);
    assert(threadHistory[tid].gHist ==
            &threadHistory[tid].globalHistory[threadHistory[tid].ptGhist]);
}
```

### squash

```cpp
void
TAGEBase::squash(ThreadID tid, bool taken, TAGEBase::BranchInfo *bi,
                 Addr target)
{
    if (!speculativeHistUpdate) {
        /* If there are no speculative updates, no actions are needed */
        return;
    }

    ThreadHistory& tHist = threadHistory[tid];
    DPRINTF(Tage, "Restoring branch info: %lx; taken? %d; PathHistory:%x, "
            "pointer:%d\n", bi->branchPC,taken, bi->pathHist, bi->ptGhist);
    tHist.pathHist = bi->pathHist;
    tHist.ptGhist = bi->ptGhist;
    tHist.gHist = &(tHist.globalHistory[tHist.ptGhist]);
    tHist.gHist[0] = (taken ? 1 : 0);
    for (int i = 1; i <= nHistoryTables; i++) {
        // 恢复原先预测之前的 comp 值
        tHist.computeIndices[i].comp = bi->ci[i];
        tHist.computeTags[0][i].comp = bi->ct0[i];
        tHist.computeTags[1][i].comp = bi->ct1[i];
        // 用正确的历史重新更新 comp 的值
        // 这些值会用于计算 index 和 tag
        tHist.computeIndices[i].update(tHist.gHist);
        tHist.computeTags[0][i].update(tHist.gHist);
        tHist.computeTags[1][i].update(tHist.gHist);
    }
}
```
