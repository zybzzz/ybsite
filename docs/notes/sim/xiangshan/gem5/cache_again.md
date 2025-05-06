# cache again

## 关注点

cache 的两头都要关注，不管是 cpu port 还是 mem port，cpu port 接受的是来自上层 cpu 或者 cache 的请求，mem port 接受的是下层存储层次拿过来的块。

## 上层通信

tryTiming 检查能不能进行 cache 端的通信。

recvTimingReq 进行请求的接收。接收的逻辑中主要会根据收到的信息进行 cache 的查找，在这个过程中发现 hit 了没有，代码中称为 satisfied。这个过程中，如果找到了，可能有块被替换，因此产生替换的块会被放到 write buffer 中等待被写回，并且整个过程中都在计算 cache 访问的延时。

随后根据是否 hit 进行分别处理。如果 hit，进入 handleTimingReqHit，先进行是不是原子操作的判断，随后进行正常读写的判断，正常读写会给 cpu 或者上层发送响应，也就是在事件队列中插入事件并等待发射回去，在上述过程中，可能会 notify 预取器并帮助其工作。

当 miss 的时候，l1 miss 会发送特别的请求。如果 mshr hit，插入到 mshr，mshr 满了就 block cache。如果 mshr miss，就 allocate mshr，分配不出来也 block。

## 下层通信

下层接受低层次的存储发送来的请求。将收到的包放到指定的位置，可能产生替换。最后释放掉 mshr 中的相关依赖。

## 官方文档

[这个文档](https://www.gem5.org/documentation/general_docs/memory_system/gem5_memory_system/) 详细介绍了应该 mshr 中和 writebuffer 中放什么东西，以及什么情况下 cache block。

