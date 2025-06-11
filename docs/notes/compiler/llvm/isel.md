# 指令选择和寄存器分配

llvm ir 通过指令选择的过程从 llvm ir 转到 machine ir。machine ir 有多种形式，根据官网上的介绍，最先转换出来的是 geniric machine ir 约束更少，通过几个 machine level 的 pass 之后，转换为 MIR，MIR 本身就和机器特征接近了，指令命名什么的都和机器特征比较像。

## isel

指令选择也是以 basic block 为单位，先从 basic block 创建出 DAG，然后对 DAG 进行 combine 的优化，然后再根据模式匹配进行指令的选择。模式匹配的定义是在 tablegen 中定义的，在 target 目录下会有这种模式匹配的定义。

## 寄存器分配

没具体去看，但是寄存器分配是在 machine scheduler 调度之后进行的，llvm 为寄存器分配提供了接口，寄存器分配方法有多种实现。寄存器分配的时候会用到之前很多 analysis pass 的信息，这些都在具体的实现中有所提到。一些体系结构相关的寄存器 abi，比如说函数调用，也是在 tablgen 中定义，然后在实现中按照定义分配。

