# cuda cpp guide

## 可伸缩的编程模型

一次编译的 cuda 程序能够在不同的运行时环境下调度执行，等于说对于实际情况下可能有不同的 SM，程序能够调度到不同的 SM 上执行。这给编程人员带来了便利，跟 cpu 一样，编过很简单，写好很麻烦。

## 编程模型

线程 id threadblock 内唯一。threadblock 内的所有线程都在一个 SM 中调度，cuda 对 threadblock 中的最大线程数做了限制，一个 SM 可以调度多个线程组。一个 kernel 也是能被分到不同的 threadblock 中执行。一个 grid 包含了多个 threadblock，一个 grid 对应着一个 kernel。thread 和 block 都能有至多 3 个维度。 `__syncthread` 同步 block 内的线程。

引入了 cluster, 多个 blocks 能够在 cluster 中，引入了 distributed shared memory 来解决 block 之间的交互问题，因为 block 可能在不同的 SM 中，同时可能也引入了一些调度优化。

异步执行的 SIMT，后续再看。

page-loacked host memory，支持异步，统一内存，更高的访存带宽。这块 memory 常驻内存，物理地址固定。

cuda graph 流水线创建。

## 硬件实现

指令发射是顺序的。

## 虚拟内存

等待着看。

## 线程本地内存

没有被 `__shared__` 声明的可能会被放到现成的本地内存中，本地内存应该是全局内存的一部分。在寄存器溢出、函数参数传递等等情况下会用到，速度是很慢的。

## 量化矩阵乘 mma

hopper 第一次支持。

