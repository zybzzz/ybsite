# selection DAG

一个很好的入门教程是[官方 meeting](https://llvm.org/devmtg/2024-10/slides/tutorial/MacLean-Fargnoli-ABeginnersGuide-to-SelectionDAG.pdf)。

selectionDAG 起到的作用是，将 LLVM IR 向 SDNode DAG 做转换，最终 DAG 会向下 lower 成 MIR。这个过程表现成 pass 就是 isel，但是这个 isel 的过程包含了很多。

首先是建图(DAG builder visit)，然后是 type lower（查看 type 是不是在本地支持，legalizeXXtype），然后是 operation lower（查看 operation 是不是在本地支持），然后才是 isel（DAG->DAG）。

这个过程中非常麻烦的一点就是对于自定义的 intrinsic 怎么创建 DAG 相关的节点，怎么给他赋值 opcode，让他在后面能转换成对应的机器码。这点 x86 的实现和 riscv 的实现有所不同。

## x86 intrinsic

intrinsic 定义的很规范，在 tablegen 中定义了 I,PI 等 class，实现 intrinsic 和机器指令相关的对应。在 DAG -> DAG rewrite 的时候，可能会变更相关的 opcode.

## riscv intrinsic

在 DAG->DAG rewrite 的时候才全面的进行 opcode 和一些变更。