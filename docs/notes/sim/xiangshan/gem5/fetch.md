# xiangshan fetch

主要记录 xiangshan 的取指阶段。

## checkSignalsAndUpdate

和先前的阶段一样，都是检查信号然后更新状态，并返回状态是否更新。

1. 更新 decode 是否 stall。
2. 检查 commit 阶段是否造成了清空：
   1. 如果产生了清空信号，清空 fetch，根据不同的清空原因告知分支预测器 squash。
   2. 如果没有产生清空信号，就正常提交，同样的更新分支预测器。
3. 分析来自 decode 阶段的清空。
4. 检查是否阻塞，如果阻塞就 blocked。
5. 没有检查到阻塞的话就将状态变成 running。

## fetch

地址翻译，翻译结束的时候回调取指。和分支预测单元的设计产生大量的相关。

地址翻译的通信都是走 mmu，数据相关的才是走 cache。

## 相关参数

1. FetchQueue：取出来的指令译码之后存在这个队列中。
2. pc_offset：当前取指的 pc 距离 aligninstlength(fetch_pc) 的距离。
3. blk_offset: 当前取指的指令到 Fetchqueue 头的距离。

## 译码

将取到的内存数据拷贝到 decoder 中进行译码，decoder instready 表示当前译码器已经能够处理一段指令了，needmorebit 表示当前在 decoder 中的指令是不完全的，还需要送进去进行译码。

## 内存访问

在判断条件需要进行内存访问的时候才进行内存的访问，fetchcacheline 创建一个请求并进行 mmu/tlb 的翻译，tlb 翻译完成之后调用 finishtranslation 进行正式的内存访问，如果 cacheblock 了，就放到 retry 队列里时机合适再重发。如果地址翻译的时候出错，创建一条空指令携带这个异常。如果 tlb miss 了，会进行 page table walk，等到 page table walk 之后在进行 finishtranslation. 在 cache 访问完成之后调用 finishCacheProcess，在调用完这个之后才会设置 fetchBufferValid 等于 true，跨块的取指访问，等到两个请求都到的时候才设置 valid。

## pipeline cache access

在每个 tick，都会检测下一个 tick 的 fetch 地址是不是跑到下一个 fetch 块中了，如果是在条件合适的情况下会进行下一个块的 cache 访问。

## 杂

对齐、求余可能涉及到跨块访问的问题。

