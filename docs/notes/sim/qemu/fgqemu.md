# First glimpse of qemu

初探 qemu。功能强大，模拟起来很复杂。这个东西和 gem5 不一样， gem5 在单个线程里面完成了所有的模拟，但是 qemu 会开辟出新的线程来进行模拟。cpu 的运行之类的完全就是在一个线程上做的，线程的调度也是由操作系统控制的。所以在 system 的模式下，完成的工作就是初始化线程，然后等线程结束。分配线程的事是初始化过程完成的，初始化的过程大部分都是 qemu QOM 组件来完成的，因此我认为切入点是这里，想要进一步了解 qemu，首先理解 QOM 是很重要的，需要知道整个机制是怎么初始化的。

还有比较重要的是可能就是对 io 的处理，初始化的过程可能相似，但是对 io 的处理肯定是有相关的机制的，这点也需要关注。

