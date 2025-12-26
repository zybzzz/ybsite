# LLVM Alias Analysis (AA) 技术总结与原理解析

## 1. 会话背景概要
本文档总结了关于 LLVM 编译构建、别名分析（Alias Analysis, AA）架构及其核心算法的讨论。重点阐述了 LLVM 如何判断两个指针是否指向同一块内存，以及这种判断如何影响编译器的优化决策（特别是针对 C/C++ 语言特性的 Strict Aliasing 规则）。

---

## 2. LLVM AA 架构与执行流程

### 2.1 核心架构：责任链模式 (Chain of Responsibility)
LLVM 的别名分析并非由单一算法完成，而是由一个管理器（`AAManager`）维护的一个**分析管线 (Pipeline)**。
当优化器（如 GVN, LICM）询问 "指针 A 和 指针 B 是否别名？" 时，`AAManager` 会按**优先级顺序**依次询问各个 AA Pass。

### 2.2 执行顺序 (Query Order)
在标准的 Release (`-O2`/`-O3`) 模式下，查询顺序通常如下：

1.  **ScopedNoAliasAA** (基于显式元数据)
2.  **TypeBasedAA (TBAA)** (基于语言类型规则)
3.  **GlobalsAA** (基于全局变量可见性)
4.  **BasicAA** (基于 IR 指令的几何/算术分析)

### 2.3 判决逻辑
每个 AA Pass 会返回以下三种结果之一：
* **`NoAlias`**: 我敢保证它们**绝不**重叠。（查询结束，返回结果）
* **`MustAlias`**: 我敢保证它们**完全**指向同一起始地址。（查询结束，返回结果）
* **`MayAlias`**: 我不知道，它们**可能**重叠。（**继续**询问管线中的下一个 Pass）

如果问到了最后一个 Pass (BasicAA) 还是 `MayAlias`，则最终结果就是 `MayAlias`，编译器必须进行保守处理。

---

## 3. 四大核心 AA 算法详解

### 3.1 ScopedNoAliasAA (最高优先级)
* **原理**: 依赖前端（Clang）生成的 `alias.scope` 和 `noalias` 元数据。这是程序员或语言特性（如 Fortran）给出的最强提示。
* **典型场景**: C99 的 `restrict` 关键字，或者函数内联后为了区分不同栈帧而自动生成的标记。
* **判断结果**:
    * **NoAlias**: 只要查到指针 A 的 Scope 列表包含了指针 B 被标记为 `noalias` 的 Scope。
    * **MayAlias**: 没有相关元数据。

### 3.2 TypeBasedAA (TBAA - 基于类型的别名分析)
* **原理**: 基于 C/C++ 的 "Strict Aliasing Rule"（严格别名规则）。LLVM 将类型视为一棵树（DAG）。
* **类型树结构**:
    * **Root**: 所有类型的祖先。
    * **Char / Void**: 可以别名任何对象（特权节点）。
    * **Int / Float / Ptr**: 互为兄弟节点，互不兼容。
* **判断结果**:
    * **NoAlias**: 两个指针指向的类型在树上没有公共祖先（或者只是兄弟关系）。
        * *例*: `float*` vs `int*`；`struct A*` vs `struct B*`。
    * **MayAlias**:
        * 类型兼容（父子关系）。
        * 其中一个是 `char*`（万能指针）。
        * 编译器使用了 `-fno-strict-aliasing` 禁用了此分析。

### 3.3 GlobalsAA (全局变量分析)
* **原理**: 分析全局变量的“逃逸”情况（Capture Tracking）。如果一个全局变量的地址从未被取过（Address not taken），或者从未传递给外部函数，它就是“宅”的。
* **判断结果**:
    * **NoAlias**:
        * 两个不同的全局变量之间。
        * 一个**未逃逸**的全局变量 vs 任何外部传入的指针（参数）。
    * **MayAlias**: 全局变量是 `extern` 的，或者其地址被取过并传递给了未知函数。

### 3.4 BasicAA (兜底主力 - 几何分析)
* **原理**: 深入分析 LLVM IR 中的 `GetElementPtr` (GEP) 指令、`alloca` 指令和对象大小。它进行纯粹的数学和逻辑推导。
* **判断结果**:
    * **NoAlias**:
        * **不同源**: 指向两个不同的 `alloca`（栈变量）。
        * **同源不同地**: 基地址相同，但 `Offset` 差值大于对象的 `Size`（如 `p[0]` 和 `p[1]`）。
    * **MustAlias**: 基地址相同且偏移量完全一致。
    * **MayAlias**:
        * **复杂索引**: `p[i]` 和 `p[j]`，且无法证明 `i != j`。
        * **PHI 节点**: 指针来自 `if-else` 的汇聚点，来源太复杂。
        * **完全未知**: 两个函数参数，没有任何类型或 `restrict` 信息。

---

## 4. AA 结果对后续优化的影响

AA 的结果直接决定了编译器敢不敢做**激进优化**。

| 优化手段 | 如果是 NoAlias | 如果是 MayAlias |
| :--- | :--- | :--- |
| **指令重排 (Instruction Scheduling)** | 读写指令可以随意交换顺序，最大化流水线并行度。 | **必须保持原序**，防止读到脏数据。 |
| **循环不变量外提 (LICM)** | 循环里的 `load` 可以提出来只做一次。 | 必须在每次循环中重新 `load`，因为循环体内的 `store` 可能会修改它。 |
| **死存储消除 (DSE)** | 可以删除冗余的写入操作。 | 必须保留写入，因为可能有人在读它。 |
| **自动向量化 (Loop Vectorization)** | 放心将多次操作打包成 SIMD 指令。 | 放弃向量化，或者生成低效的运行时检查代码 (Runtime Checks)。 |
