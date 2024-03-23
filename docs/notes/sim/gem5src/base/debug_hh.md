# debug.hh 解析

简单的解析 `debug.hh` 这个文件，这个文件似乎是为 debugflag 提供的支持，所以不用过于细致的追究。

首先在这个名称空间中定义的是 `void breakpoint();` 函数，这个函数和 pdb 中的 breakpoint 函数很像，就是在代码中插入这个函数能够实现断点的效果。

后续定义了好几种flag类，主要应该就是用来维护调试时候的flag。
