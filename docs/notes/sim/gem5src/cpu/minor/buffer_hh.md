# buffer.hh 解析

这里简单的解析 minor 中各类 buffer 的实现。

## 两个基本接口与适配器

两个接口为 `ReportIF` 和 `BubbleIF`，实现这两个接口拥有打印追踪信息生成空对象（气泡）的能力。适配器为 `ReportTraitsAdaptor` 和 `BubbleTraitsAdaptor`，这类适配器给调用者提供统一的打印报告和产生气泡的接口。

## Minorbuffer

`Minorbuffer` 继承了 `TimeBuffer`，等于在其之上再做封装。

实际上 `Minorbuffer` 只是新增了 `empty` 方法来判断 `TimeBuffer` 中是否含有气泡，并且实现了 `minorTrace` 方法方便打印数据。

## Latch

Latch 是 minor 中非常重要的数据结构，他是锁存器的抽象，各个流水段之间的寄存器就是使用的 Latch。Latch 从代码上来说其内部还是使用的 `TimeBuffer`。

```cpp
template <typename Data>
class Latch
{
  public:
    typedef MinorBuffer<Data> Buffer;

  protected:
    /** Delays, in cycles, writing data into the latch and seeing it on the
     *  latched wires */
    Cycles delay;

    Buffer buffer;
    
    // ... 
}
```

Latch 中包含两个成员，一个是 delay 代表锁存器的延迟，就是过了这么一段时间，这个锁存器的状态才会改变；buffer 则直接指向底层存储的 timebuffer。在其构造方法进行构造的时候，默认的延迟为 1 个时钟周期。

最为关键的是其 input 和 output 方法。这两个方法可以理解成一个锁存器的输入端和输出端。

```cpp
    /** An interface to just the input of the buffer */
    Input input() { return Input(buffer.getWire(0)); }

    /** An interface to just the output of the buffer */
    Output output() { return Output(buffer.getWire(-delay)); }
```

实际上输入端和输出端就是获取 timebuffer 的 wire。`getWire` 是会随着 `base` 的位置变化而动态变化 `wire` 的位置的，这就表示输入和输出都是适应 timebuffer 的特性的。总而言之，input 和 output 直接视为输入输出的连线便是，在延迟未到还不能获得下一个结果的时候，得到的可能是一个气泡。

## SelfStallingPipeline

SelfStallingPipeline 是对功能单元流水线的建模，底层的本质还是 timebuffer。同样的引入了 pushWire 和 popWire 表示功能流水线的头和尾，其类型也是 wire，原理同上面是一样的。其还引入了两个成员变量：stalled表示流水线是否阻塞，如果被设置为阻塞，流水线无法往下进行； occupancy 表示流水线中真实数据也就是非气泡数据占用的空间。同样的在初始化的时候会将整个 buffer 中的数据设置为气泡。

SelfStallingPipeline 的 push 操作是吧某个计算放到流水线上。检测某个操作在流水线上完成即检查 popWire 对应的位置是不是气泡。最为关键的是 advance 操作，等于打了一个节拍，流水线往下走一个单位。

```cpp
void
advance()
{
    bool data_at_end = isPopable();

    if (!stalled) {
        TimeBuffer<ElemType>::advance();
        /* If there was data at the end of the pipe that has now been
            *  advanced out of the pipe, we've lost data */
        if (data_at_end)
            occupancy--;
        /* Is there data at the end of the pipe now? */
        stalled = isPopable();
        /* Insert a bubble into the empty input slot to make sure that
            *  element is correct in the case where the default constructor
            *  for ElemType doesn't produce a bubble */
        ElemType bubble = BubbleTraits::bubble();
        *pushWire = bubble;
    }
}
```

首先检查是否有数据可以pop，随后：

- 如果当前功能单元流水没有被阻塞：那么流水线可以往下进行，调用 timebuffer 的方法使流水线往下进行一步。如果原先有数据已经能出流水线（可以pop），前进一步表示清空了一个数据，于是 occupancy - 1，如果这一步导致了数据出流水线，那么 stalled 将会被设置为 true，这样的操作可能是为下一步的暂停做准备。随后跟给输入端变成气泡。
- 如果当前的功能单元流水被阻塞：这个函数不进行任何操作，等于如果被阻塞了，流水线就不再往下进行了。

## Reservable

实现这个接口的类表示能够为未来空出一些位置。

## Queue

一个简单的能够保留一定空间的队列的实现。主要需要注意的是里面有关容量的几个成员变量的含义。`capacity` 表示预期的最大空间，这个空间是可以超的。`queue.size()` 表示的是当前队列实际用了多少空间。`numReservedSlots` 表示的是当前预订的空间个数，这只是个数的记录，空间实际上还没被分配出去。实际上期望的应该是实际数目加上预分配数目小于 capacity。

## InputBuffer

实际上是对 Queue 的利用，用于在流水线各个阶段之间传输数据。这个 buffer 直接按照最正常的 buffer 理解就行了，定义这个类只是为了某些操作加快速度。
