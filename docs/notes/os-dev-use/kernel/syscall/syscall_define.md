# linux syscall define

现在的 syscall 跳转表实现貌似不再采用指针式数组的实现，主要使用了 switch 来实现，本质还是一个跳转表。

1. `include/linux/syscall.hh`：定义了一堆系统调用使用到的宏。
2. `syscalls_64.h`：实现了系统调用号和系统调用函数的定义。
3. `syscalls_64.c`：实现了用于跳转的 switch 语句，switch 会跳转到一个处理函数上，将系统调用参数从寄存器中取出来，然后交给具体的系统调用。具体的系统调用名字可能是 `do_sys_...` 之类的。
4. `SYSCALL_DEFINE`：分布在内核各个源文件中的宏，就是这个宏里面定义的就是系统调用的实现代码。

