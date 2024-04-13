# gem5 cpu 模型

主要介绍 gem5 中的 cpu 模型。

## BaseCPU

几乎处于 cpu 继承树的顶层，BaseCPU 是所有后续 cpu 的父类，它抽象出了一个非常简单的 cpu 模型，把后续所有 cpu 需要用到的公共功能封装到了这个 BaseCPU 中，这个 cpu 并不具备执行指令的能力。

BaseCPU 封装了如下的功能：

1. 统计数据。抽象出一些公共的统计数据组，如 `GlobalStats`（ipc 就在这个统计数据组中计算）、`FetchCPUStats` （取值相关的统计信息）、`ExecuteCPUStats` 和 `CommitCPUStats`。
2. 中端控制器相关的成员。为 BaseCPU 中运行的每个线程设置中断处理器，并且提供发送中断的接口。
3. cpu 切换。BaseCPU 中包含了 cpu 切换、或者从其他 cpu 中恢复、清除 TLB 等函数。
4. 获取端口。BaseCPU 中定义了从指令接收端口和数据接收端口获取端口的方法，子类中必须实现这些方法。也即子类中必须也得提供这几个端口。



