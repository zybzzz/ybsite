# fu_pool and fu

主要讲解 o3 部分乱序功能单元的实现。功能单元的功能和数量都在 python 文件中设置，功能单元的实现是由 cpp 实现的。

## python 配置部分

在 python 的 o3 cpu 中，进行了功能单元的配置，将功能单元设置为 `DefaultFUPool`，查看 `DefaultFUPool` 源码可以发现：

```python
class FUPool(SimObject):
    type = "FUPool"
    cxx_class = "gem5::o3::FUPool"
    cxx_header = "cpu/o3/fu_pool.hh"
    FUList = VectorParam.FUDesc("list of FU's for this pool")


class DefaultFUPool(FUPool):
    FUList = [
        IntALU(),
        IntMultDiv(),
        FP_ALU(),
        FP_MultDiv(),
        ReadPort(),
        SIMD_Unit(),
        PredALU(),
        WritePort(),
        RdWrPort(),
        IprPort(),
    ]
```

FUPool 只是简单的维护了一个功能单元的列表，具体的功能单元的功能应该是列表中的部件实现的。随便挑一个部件，比如 `IntALU`，查看其实现：

```python
class IntALU(FUDesc):
    opList = [OpDesc(opClass="IntAlu")]
    count = 6
```

可以看到其继承了，`FUDesc`，并在其中维护了一个列表，这个列表表示这个功能单元能够用于什么操作和操作的延迟，另外维护了一个 count 变量，表示这个功能单元的数目有几个。查看其定义：

```python
class FUDesc(SimObject):
    type = "FUDesc"
    cxx_header = "cpu/func_unit.hh"
    cxx_class = "gem5::FUDesc"

    count = Param.Int("number of these FU's available")
    opList = VectorParam.OpDesc("operation classes for this FU type")
```

发现 `FUDesc` 的描述确实如我们所说。

现在研究，`opList` 中维护的 `OpDesc`，毕竟这个部分才决定了功能单元能进行什么样的操作。查看其定义：

```python
class OpDesc(SimObject):
    type = "OpDesc"
    cxx_header = "cpu/func_unit.hh"
    cxx_class = "gem5::OpDesc"

    opClass = Param.OpClass("type of operation")
    opLat = Param.Cycles(1, "cycles until result is available")
    pipelined = Param.Bool(
        True,
        "set to true when the functional unit for"
        "this op is fully pipelined. False means not pipelined at all.",
    )
```

可以看到这之中定义了三个成员，`opClass` 决定了能够进行哪种类型的操作，`opLat` 决定了操作所需要的实现，`pipelined` 决定了这个单元是否完全流水线化实现。这些都是比较好理解的参数。

## cpp 实现部分

首先先看 FUPool 的定义，其头文件中对其定义如下：

```cpp
class FUPool : public SimObject
{
  private:
    // 每种计算功能在所有单元中实现的最大延迟
    std::array<Cycles, Num_OpClasses> maxOpLatencies;
    // 默认为true，对于每种 OpClass，
    // 如果有一个功能单元中的实现为false，就将其设置成false
    std::array<bool, Num_OpClasses> pipelined;

    // 用于记录FUPool本身，对于各种 OpClasses 是否支持的位图
    std::bitset<Num_OpClasses> capabilityList;

    // 每个具体的功能单元是否空闲
    std::vector<bool> unitBusy;

    // 记录即将被设置为空闲的功能单元
    std::vector<int> unitsToBeFreed;

    // 这是一个内部类，实际上就是记录 OpClass 在 unitBusy 中的下标
    class FUIdxQueue
    {
      public:
        FUIdxQueue()
            : idx(0), size(0)
        { }

        // 将 fu_idx 插入到向量中，并自增 size
        inline void addFU(int fu_idx);

        // 不断返回 funcUnitsIdx 中记录的下标,
        // 是通过 idx 不断访问实现的，
        // 当 idx 到尾部的时候会重新返回到头部
        inline int getFU();

      private:
        /** Circular queue index. */
        int idx;

        /** Size of the queue. */
        int size;

        /** Queue of FU indices. */
        std::vector<int> funcUnitsIdx;
    };

    // 每种 OpClass 类型有一个 FUIdxQueue
    FUIdxQueue fuPerCapList[Num_OpClasses];

    // 总共的功能单元的数量
    int numFU;

    // 所有功能单元
    std::vector<FuncUnit *> funcUnits;

    typedef std::vector<FuncUnit *>::iterator fuListIterator;

  public:
    typedef FUPoolParams Params;
    /** Constructs a FU pool. */
    FUPool(const Params &p);
    ~FUPool();
    
    // 代表这个功能池不支持这种操作
    static constexpr auto NoCapableFU = -2;

    // 代表这个池支持这种操作，但是还没有空闲的单元空出来去执行
    static constexpr auto NoFreeFU = -1;
    
    // 尝试获取支持某种类型的功能单元
    // 不支持返回 NoCapableFU
    // 没空闲返回 NoFreeFU
    // 正常情况返回可供使用的功能单元的下标号
    int getUnit(OpClass capability);

    // 将功能单元下标加入到 unitsToBeFreed 中
    void freeUnitNextCycle(int fu_idx);

    /// 释放出现在 unitsToBeFreed 中的功能单元
    void processFreeUnits();

    // 返回总共的功能单元的数量
    int size() { return numFU; }

    // 多池中的数据功能单元信息进行打印
    void dump();

    // 返回某个功能在所有功能单元中实现的最大延迟
    Cycles getOpLatency(OpClass capability) {
        return maxOpLatencies[capability];
    }

    // 返回某个功能在所有功能单元中是否有非流水线的实现
    bool isPipelined(OpClass capability) {
        return pipelined[capability];
    }

    // ...
};

```

这里面比较值得关注的是 FUPool 的构造函数和 getUnit 函数：

```cpp
FUPool::FUPool(const Params &p)
    : SimObject(p)
{
    // 初始化相关的数据
    numFU = 0;

    funcUnits.clear();

    maxOpLatencies.fill(Cycles(0));
    pipelined.fill(true);

    const std::vector<FUDesc *> &paramList =  p.FUList;
    for (FUDDiterator i = paramList.begin(); i != paramList.end(); ++i) {

        // 对于每个功能单元，都配置了其数量
        if ((*i)->number) {
            // 构造出一个功能单元
            FuncUnit *fu = new FuncUnit;

            OPDDiterator j = (*i)->opDescList.begin();
            OPDDiterator end = (*i)->opDescList.end();
            // 对于每个功能单元都配置了其支持的多种操作
            for (; j != end; ++j) {
                // 对于每种支持的操作，更新功能池中的位图
                capabilityList.set((*j)->opClass);

                // 对于每个功能单元生成其全局唯一的标签
                for (int k = 0; k < (*i)->number; ++k)
                    fuPerCapList[(*j)->opClass].addFU(numFU + k);

                // 将信息记录到功能单元对象中
                fu->addCapability((*j)->opClass, (*j)->opLat, (*j)->pipelined);

                // 更新功能池中的 maxOpLatencies
                if ((*j)->opLat > maxOpLatencies[(*j)->opClass])
                    maxOpLatencies[(*j)->opClass] = (*j)->opLat;

                // 更新功能池中的 pipelined
                if (!(*j)->pipelined)
                    pipelined[(*j)->opClass] = false;
            }

            numFU++;

            // 给功能单元命名
            fu->name = (*i)->name() + "(0)";
            funcUnits.push_back(fu);

            // 通过对 fu 生成多个功能单元并添加到 funcUnits
            // 其全局编号已经在上面的 if 判断中提前生成过
            for (int c = 1; c < (*i)->number; ++c) {
                std::ostringstream s;
                numFU++;
                FuncUnit *fu2 = new FuncUnit(*fu);

                s << (*i)->name() << "(" << c << ")";
                fu2->name = s.str();
                funcUnits.push_back(fu2);
            }
        }
    }

    // 重置 unitBusy 的大小
    unitBusy.resize(numFU);

    // 将其初始化为 false
    for (int i = 0; i < numFU; i++) {
        unitBusy[i] = false;
    }
}
```

再关注其 getUnit 函数：

```cpp
int
FUPool::getUnit(OpClass capability)
{
    // 如果功能池不支持这种操作 直接返回不支持
    if (!capabilityList[capability])
        return -2;

    int fu_idx = fuPerCapList[capability].getFU();
    int start_idx = fu_idx;

    // 对所有的功能单元进行遍历
    while (unitBusy[fu_idx]) {
        fu_idx = fuPerCapList[capability].getFU();
        if (fu_idx == start_idx) {
            // 如果对所有支持这种操作的功能单元都遍历完一遍
            // 还没发现有空闲的，直接返回没有功能单元
            return -1;
        }
    }

    assert(fu_idx < numFU);

    // 否则将选出的功能单元设置为忙碌
    unitBusy[fu_idx] = true;

    // 返回这个选出的功能单元。
    return fu_idx;
}
```

其中需要关注的还有 FuncUnit 中的 addCapability 方法：

```cpp
void
FuncUnit::addCapability(OpClass cap, unsigned oplat, bool pipeline)
{
    // 不支持操作延迟为0的功能单元
    if (oplat == 0)
        panic("FuncUnit:  you don't really want a zero-cycle latency do you?");
    
    // 设置这个单元支持某种类型的操作
    capabilityList.set(cap);

    // 设置操作延时
    opLatencies[cap] = oplat;

    // 设置这个功能单元是否支持某种功能的流水
    pipelined[cap] = pipeline;
}
```

每种功能单元中实际记录了相关操作的详细延迟，从 FUPool 看还以为所有的功能单元共用一个最大的延迟，实际上应该不是，各个功能单元应该用的是这个当中记录的延迟，因为这些数据都是公开可访问的。程序可以访问这些对象取得详细数据。
