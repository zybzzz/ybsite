# C语言启动与运行时

常规编写c语言文件的时候，往往都是写一个 main 函数，然后在 main 函数中写自己的处理逻辑，然后通过编译器编译啊得到可执行文件进行执行，但是对可执行文件进行反汇编可以发现，反汇编出来的汇编中，除了 main 这个节之外还有如 `_start`、`_init` 这样的部分。这部分并不是我们手写的，因此想要弄懂这个过程，到底是谁加上了这些东西？到底是编译器、汇编器、还是链接器。后来发现这部分实际上关系到c语言的启动与运行时的创建还有操作系统 abi 相关的知识，于是在此做记录。

## API 与 ABI

对 abi 的理解专门又有了一篇文章：[各类abi解析](./abi.md)

暂时不知道 ABI 和这个问题有什么联系，但是 ABI 是很重要的概念，但是很复杂。理解 ABI 可以参考的资料有：

1. [你们说的ABI，Application Binary Interface到底是什么东西？](https://www.zhihu.com/question/381069847)
2. [彻底理解 C++ ABI](https://zhuanlan.zhihu.com/p/692886292)
3. [What is an ABI](https://stackoverflow.com/a/2171227/24979298)

API 和 ABI 之间的区别，更像一个规定了表层一个规定了底层，API 提供了到底有哪些函数可以调用，ABI 规定了我从汇编层面该遵从哪些规范去调用这个函数。

现在对ABI这个概念并没有太深和太正确的理解，因此在此有一点简单的理解。ABI，即模块和模块之间的二进制接口，这个二进制接口可以是用户程序和库之间，或者是用户程序与操作系统之间，这也就意味着 ABI 并不是只有一个，不同模块之间的二进制交互就会产生 ABI 规定。以用户程序和库为例，API 规定了我能调用哪些函数，ABI 规定了我该如何从库中找到这个函数，我又如何通过汇编的压栈等去调用这个函数，是这样的关系。以用户和操作系统之间举例，用户通过操作系统 API 能够获得操作系统信息，操作系统 ABI 规定了通过哪些寄存器或者内存位置能访问到这些信息。API 和 ABI 之间就是这样的关系，这是对 API 和 ABI 之间的简单理解。

## 从源文件到可执行的文件

下面尽量解释清楚过程以及尽量讲清楚为什么。

一个可执行文件的加载过程是操作系统进行fork，然后进行PCB相关的设置，最后将pc指针指向`_start`的位置。因此在编译得到最后的可执行文件中，需要有`_start`标记。在一个c文件编译成汇编的过程中，`_start`还没出现，汇编成可重定位目标文件的时候也还没有出现，只有通过链接器进行链接之后才出现。通过 `ld --verbose`的输出我们能够发现：

```ldscript
ENTRY(_start)
SEARCH_DIR("=/usr/local/lib/x86_64-linux-gnu"); SEARCH_DIR("=/lib/x86_64-linux-gnu"); SEARCH_DIR("=/usr/lib/x86_64-linux-gnu"); SEARCH_DIR("=/usr/lib/x86_64-linux-gnu64"); SEARCH_DIR("=/usr/local/lib64"); SEARCH_DIR("=/lib64"); SEARCH_DIR("=/usr/lib64"); SEARCH_DIR("=/usr/local/lib"); SEARCH_DIR("=/lib"); SEARCH_DIR("=/usr/lib"); SEARCH_DIR("=/usr/x86_64-linux-gnu/lib64"); SEARCH_DIR("=/usr/x86_64-linux-gnu/lib");
```

在链接的时候，链接器会在库中查找 `_start` 节并链接到可执行文件中来，这个节在glibc中有实现，于是被链接了过来，在这个`_start` 的实现中，会调用 glibc 中的函数，glibc 中的函数又会调用 main 函数，这就实现了 c 语言进入到 main 中执行。

## 自己编写入口程序时

在自己直接编写 _start 程序代替常规入口程序的时候，要注意执行完程序之后要进行系统调用进行退出，正确的将进程的执行返回值返回给 exec 加载器，不然会产生段错误。