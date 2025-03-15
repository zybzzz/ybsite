# cache

复杂

## 组件

### Queue entry

主要封装的是在队列中的一个 packet，因为队列中的包可能产生地址重复之类的，因此重新封装下队列中的元素。主要用在 mshr 和 writebuffer 中。中间设置了一些方法，主要是检测地址冲突之类的，在查询的时候会返回一个 Target 类，是包括优先级在内的详细信息。

### MSHR

Queue entry 的子类，主要重新封装了一下 target 和定义了基于 target 的 list，插入到当前 MSHR 的元素应该被维护在这个 target list 中。

### Queue\<T\>

主要封装了三条队列，freelist 完全空闲，readylist 还在准备中流量还没发送到下游，allocatelist 流量完全发送到下游，这三个队列中的元素空间都是由一个 vector 申请的。然后提供方法来维护。

### Cache MSHR

`Queue<MSHR>` 的封装。

### Cache Write queue

和 mshr 同样的封装方法。

### Tag

代表 cache 的 tag，同时直接将数据也封装进了这个里面，提供了查找的接口（access，没找到返回 null）和替换的接口（victim），不同的子类应该有不同的实现。

### CacheBlk

块的实现，非常复杂。

### packetqueue

一个队列，存储大量的packet，port 的实现在继承这个类来实现。

## 读写

读写主要在端口中实现。分别从 cpuside port 和 memside port 去看。

## 预取

基于 probepoint 实现的预取，主要需要关注 basecache 中定义的 probepoint，在主 prefetcher 中会对 notify 做响应(sms.cc)，calculateprefetch 中实现子预取器的调用。
