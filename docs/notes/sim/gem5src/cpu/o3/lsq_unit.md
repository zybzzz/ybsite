# LSQ Unit

LSQ Unit 实际上真正实现了 load store queue，每个线程都有自己对应的 LSQ Unit 也就是 load store queue。

## WritebackEvent

在指令完成写回的时候触发这个事件。

## recvTimingResp

实际上调用的是 LSQRequest 的 recvTimingResp 方法，看起来像是完成一些内存上的操作。

## completeDataAccess

处理了很多与硬件事务内存相关的操作，简单的来讲，对于内存相关的指令，都会调用其相关的complete函数。

## trySendPacket

测试发送 packet 的条件，不管测试发送的条件是否符合，都会对 request 和 LSQ Unit 的内部状态进行改变，最后返回 true 或者 false 代表状态是否满足。

## startStaleTranslationFlush

不管 storeQueue 和 loadQueue 中的 entey 处于何种状态，只要其合法，进行阻塞。

## checkStaleTranslations

检查两个队列中是否有 stale 的 entry。有就返回 true。

## recvRetry

在 store block 的情况下 writebackBlockedStore。

## getLoadHeadSeqNum 和 getStoreHeadSeqNum

返回头部的序列号。

## write

对于给定的 data，store 到某处。实际上就是将传入参数中的数据提取出来，封装到相关的 store entry 中。

## read

暂且认为是读取内存的相关操作。

## insertLoad

只是将指令插到 load queue 中，形成相应的 entry。

## insertStore

同样是插入到队列中，形成响应的 entry。

## commitLoad 和 commitLoads

将指令从 lq 中移除。

## commitStores

像是将 entry 设置成可以写回的标志。

## writebackBlockedStore

可能会设置 setCompleted。

## writebackStores

会调用 completestore 去 setCompleted。

## squash

清空指令。

## getMemDepViolator

拿到违反内存序的指令。

## initacc 和 completeacc

staticinst的这两个方法调用的是 ExecContext 中相关的方法，在 o3 中，普通指令走的调用应该是 dyn_inst 中的 initiateMemRead 和 setRegOperand。

## inst 状态变化

1. writeback事件的回调中，如果指令没有执行，指令就会 setExecuted。
2. insert 中会设置 setInLSQ。
3. completeStore中，store 相关的指令会被设置成 setCompleted。
4. checkViolations中，可能设置`instFlags[PossibleLoadViolation]`。
5. executeLoad，调用 initiateAcc，可能设置 setExecuted。
6. executeStore，可能设置 setExecuted，但是概率比较低。
7. squash 会将指令状态设置成 setSquashed，清除掉 load/store queue中的相关内容。
8. storePostSend也有可能导致setCompleted。
9. read中可能会clearIssued。
