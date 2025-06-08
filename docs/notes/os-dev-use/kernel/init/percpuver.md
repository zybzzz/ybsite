# per cpu var vs thread local

看到了 per cpu variable 和 thread local，就研究了一下，感觉这两个东西很像。per cpu var 是每个硬件线程独有的变量，而 thread local 是每个线程拥有的变量。

per cpu var 的实现是在定义变量的时候，定义一个特殊的 section，在编译的时候，per cpu var 的信息会被记录到编译出的 elf 里面。等到操作系统 boot 的时候，会读取这个段的信息，并分配内存。要访问的时候，每个硬件线程通过封装的宏访问就行了，实际上应该也是 base addr + offset 的转换。

thread local 是线程库和操作系统为用户空间的线程提供的特性。程序中声明 thread local ，在线程创建的时候应该也会读取这些信息，操作系统在创建 task struct 的时候会给用户空间分配这些变量的内存空间，体系结构会有寄存器专门用来记录每个线程存储 thread local 空间的 addr，在上下文切换的时候，把这个指针的位置指向每个线程正确的 addr 就行了。