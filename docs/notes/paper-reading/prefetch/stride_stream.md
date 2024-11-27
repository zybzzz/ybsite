# stream / stride prefetch

## 注意的关键点

首先是预取到的位置，预取出来的块可以放到 cache 里面也可以放到一个单独的 buffer 里面，放到 buffer 里面避免污染，但是会产生额外的空间开销。

然后是产生预取的方法，总结起来有下面的三种：

1. Fetch 指导提前探测的：利用 pc look ahead, look ahead 到记录的位置开始预取。
2. demand 按需预取：等到第一次触发 cache miss 的时候开始预取，简单的如 nextline prefetch 和 sms.
3. decouple 结构架构：提前执行来触发预取。

## stream

简单的 stream 预取，cache miss 的时候触发。

## pred dictor stream buffer

看的不是很懂，但是和 AVPP 很像，是对 load 地址进行预测，然后进行预取。

## An Effective On-Chip Preloading Scheme To Reduce Data Access Penalty

一个 lookahead pc 与预取器中的表项进行匹配从而触发预取。这篇文章比较大的特点是考虑了预取进入到 cache 的时间，预取块过早进入会导致原先有用的块被驱逐，进入的太晚，预取就没用了。

## Feedback Directed Prefetching: Improving the Performance and Bandwidth-Efficiency of Hardware Prefetchers

提出了一种动态调整的预取机制，个人感觉非常厉害的一篇文章。

提出了三个指标（预取精准度、预取延时率、预取造成的污染程度）来动态的调整预取激进程度。激进程度是用预取距离和预取度来衡量的，预取举例就是离真正产生内存访问指令多远就开始预取，预取距离越远代表越早开始预取。预取度表示一次取多少，预取度越多代表一次取得越多。

三个指标的计算方法分别如下：

1. 预取精准度：最后有用到的预取 / 发送到内存的预取请求。
2. 预取延迟率：最后有用到但是迟到的预取 / 最后有用的预取。迟到的预取，即当前的地址被用到的时候，这个块在 cache 中还没被取到。
3. 预取污染率：由预取造成的 cache 缺失 / 所有的 cache 缺失。

从硬件上讲都可以实现。

同时这个动态调整的机制也会预取块进入 cache 的时候的 LRU 堆栈位置。