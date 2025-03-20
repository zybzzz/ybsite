# return address stack

主要看的是这个文章 [^1]，主要是讲返回地址栈的修复测量。这里更多的是集中在硬件的层面，因为从模拟器的层面上，从软件恢复来说，返回地址栈的工作是非常容易恢复的。

## 工作原理

ras 的工作原理就是在取指阶段进行 call 函数调用的时候，把 call 指令的下一个地址也就是调用的返回地址压到栈中。在 ret 返回的时候，把栈中的地址取出来当作返回地址。

## 存在的问题

1. 溢出。ras 满的情况下，新进来的把老的覆盖掉了，导致了返回地址的丢失。
2. 空。ras 空的情况下可能返回一个错误的 return address，导致 BTB misspred.
3. 错误路径执行。这里的错误路径执行指的是在错误的执行路径上，出现了不成对的 call/ret，把正确路径上的地址用掉了，或者就是多加了错误路径上的地址。

## 解决

从模拟器层面上，因为不用考虑到硬件，从软件层面上的恢复是很简单的，从硬件上，作者设计了保存栈指针的做法，也就是恢复的时候将进入错误路径之前的栈指针保存住，恢复的时候直接从这个指针恢复出来就行了。

## ras 错误造成的问题

即使真的出错了，ras 提供了一个错误地址给 ret。等到 ret 到达后端返回地址的寄存器被解析之后，才发现错误，继续进行分支的清空，然后就进入到了正确的路径。在这之后就不会出问题了，开销应该就是处理器后端的 squash。但是要是 ras 频繁出错，带来的开销应该是很大的。


[^1] Skadron, Kevin, et al. "Improving prediction for procedure returns with return-address-stack repair mechanisms." Proceedings. 31st Annual ACM/IEEE International Symposium on Microarchitecture. IEEE, 1998.