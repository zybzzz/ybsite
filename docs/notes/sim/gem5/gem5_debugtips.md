# gem5 调试技巧

这里主要记录一些 gem5 的调试技巧，能够快速定位问题所在或者学习源代码。

## 写在开始：学习源代码的方式

之前看源代码采用的都是直接调源码的方式，这次使用了使用 debuger 追踪调试的方式，发现非常的好用。以后只要对源代码有最基本的了解之后，就可以在自己感兴趣的模块打断点然后进行调试，这比直接看代码的效率高很多。原因在于一个源文件中的函数具有不同的含义，并且可能在不同的阶段被调用到，直接看源代码的话往往会把函数都看一遍，但是对于这些函数调用链的理解还是很混乱的。通过 debug 的方式，不仅能够更加了解清楚调用链，而且对于不在调用链之内的函数可以先不用看，也算是减轻了一点看源代码的量，这样的方式会更加高效一点。

## 利用调试器调试，配合 trace 一起调试

gem5 支持使用 gdb 调试，可能 opt 形式下也能进行 debug，但是至少在 se 模式下，编译出的 debug 调试更加的方便。至于 gem5 的 python 部分能够使用 pdb 进行调试，只要你想，其实是能够进行联调的。

至于在调试的时候，必然是在自己感兴趣的地方打上断点，然后用 gdb 进行调试。在调试的过程中可以使用 gdb 的 bt 命令进行调用栈的查看。当然有时候这个过程并不能让你找到相关的问题所在，这时候还有一个方法，根据 gem5 官方提供的一些 gdb 调试方法，我们能够在调试的过程中开启一些 debug 标记，让 debug 标记打印的信息告诉我们什么函数执行了。再对感兴趣的函数打上断点然后进行调试。

另外就是函数的调用栈最底层一定是 pybind 相关的调用，到这里为止表明调用端处于 python 中，需要去 python 相关的文件中查找到底是谁进行了调用。
