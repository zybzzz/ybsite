# 操作系统入门

## 编译优化值得思考的四方

syscall 是从系统外部看到系统内部状态的唯一方式。因此编译优化在保证不改变 syscall 和程序正确性的情况下就能保证语义的正确性，能够进行激进的编译优化。很有道理，但是还想不通。

## 状态机模型

更多的强调的是系统内部很多都是状态机模型，不必对此感到恐惧。

## 操作系统的加载

第一次如此简单的了解。在启动的时候硬件先检查磁盘的第一块的最后两字节(== 0x????)，符合要求的认为是启动盘。从启动盘中选一个，硬件会将这个扇区的代码加载到内存中的指定位置（pc初始化应当就是这个位置），通过这段代码可以在进行一些操作之后进行分支跳转，将地址设置成 bios 或者其他程序的地址，然后再由 bios 实际加载操作系统。
