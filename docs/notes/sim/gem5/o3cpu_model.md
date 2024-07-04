# O3CPU model

这篇文章主要是 o3cpu 的杂记，o3cpu 太过复杂，因此只挑一部分对我有用的进行记录。

## rename 阶段

rename 阶段的实现在[这篇文章](../gem5src/cpu/o3/rename.md)中找到。

## IEW 阶段

IEW 阶段可以参考[这篇文章](../gem5src/cpu/o3/iew.md)。

## Commit 阶段

commit 的实现在[这篇文章](../gem5src/cpu/o3/commit.md)中找到。

### ROB 实现

重排序缓冲的实现可以在[这篇文章](../gem5src/cpu/o3/rob.md)中找到。
