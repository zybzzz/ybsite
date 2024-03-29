# Simulating DRAM controllers for future system architecture exploration(ISPASS'14)

这篇文章主要提出了一个高效模拟内存的方法，不同于其他模拟器采用周期模拟直接模拟内存的方式，这篇文章采用事件驱动的模拟并且并不直接模拟内存，而是模拟内存控制器，后来这个模拟的模型被集成到了 gem5 中，成为了 gem5 的内存模拟框架。这里主要对第二节原理和设计部分进行记录。

## 内存控制器架构

多控制器共享的读写队列。内存多通道间使用 CrossBar 交互。对于多个突发的写请求会尝试写合并。低延迟，早期响应。

## DRAM 时序

引入状态机。仅选取关键的时序信息做模拟。不能模拟多通道之间的切换。跟踪总线的可用性，数据竞争。不同的 DDR 内存之间用时间信息加以区分。引入前后端延迟，前段延迟是处理请求、地址解码的延迟，后端延迟是内存控制器到物理接口以及 I/O 上的延迟。

## 队列调度

支持内存的 close 和 open page 策略。对于读写的请求是多级调度的形式，第一级调度先调度读写，第二级调度会调度读或者写队列中的优先顺序，有在行缓冲中的会先被调度。
