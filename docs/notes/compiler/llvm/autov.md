# LLVM Vectorization Subsystem Summary: Current State & Architecture (2025)

## 1. 核心矛盾：中端抽象 vs 后端差异
LLVM 中端（Middle-end）向量化的核心难点在于**通用 IR 与特异硬件**之间的鸿沟。
- **抽象层：** LLVM IR 试图保持通用（如 `<4 x i32>` 或 `<vscale x 4 x i32>`）。
- **硬件层：** 处理器实现差异巨大（定长 vs 变长，Mask 支持，Gather/Scatter 代价）。
- **桥梁 (TTI)：** **TargetTransformInfo** 是中端向后端查询的接口，用于获取合法性（Legality）、代价（Cost Model）和配置（Vector Width）。

---

## 2. 向量化主要组件

### A. SLP Vectorizer (Superword-Level Parallelism)
- **定位：** **基本块 (Basic Block)** 级别的向量化。
- **原理：** **Bottom-Up (自底向上)**。
    1.  **种子发现：** 寻找连续的 Store 或 Load 指令。
    2.  **树构建：** 沿着 Use-Def 链向上回溯，将标量指令打包成向量树。
    3.  **调度：** 确保打包不违反数据依赖。
- **适用场景：** 手动展开的循环、结构体操作、复数运算、Loop Unroll 后的代码。
- **主要产出：** 将多条标量指令合并为单条向量指令（Vectorize instructions distinct from loops）。

### B. Loop Vectorizer (LV) - Classic & Modern
- **定位：** **循环 (Loop)** 级别的向量化。
- **原理：** **Top-Down (自顶向下)**，将时间（迭代）转化为空间（向量宽度）。
- **流程：**
    1.  **Legality：** 检查内存依赖 (MemorySSA, Alias Analysis) 和控制流。
    2.  **Cost Model：** 计算 VF (Vectorization Factor) 和 UF (Unroll Factor)。
    3.  **Transform：** 生成向量循环主体 + 标量尾部 (Scalar Epilogue)。

### C. VPlan (The Modern Engine)
- **定位：** Loop Vectorizer 的现代内核，显式的向量化规划模型。
- **核心机制：**
    - **H-CFG：** 分层的控制流图，独立于底层 LLVM IR。
    - **Recipes：** 描述最终指令生成的配方（如 `VPWidenRecipe`）。
    - **VPlan-to-VPlan Transforms：** 在图层面进行优化（Predication, Dead Code Elimination）。
- **现状 (2025)：** 已接管 LV 的代码生成路径，支持基于 VPlan 的 Cost Model。

---

## 3. 变长向量化 (Scalable Vectorization / RVV) 的挑战与解法

### A. 核心痛点
- **未知长度：** 编译期不知道 `vscale` (VLEN)，打破了传统定长向量化的假设。
- **Shuffle 失效：** LLVM IR 的 `shufflevector` 指令强制要求 Mask 为**编译期常数**。
    - *后果：* 无法用标准 IR 表达 `Reverse` (逆序) 或 `Stride` (跨步) 等操作，因为它们的 Mask 索引依赖运行时长度。

### B. VPlan 的解决方案
VPlan 是 RISC-V 高效向量化的救星，它允许在更抽象的层级处理这些问题：
1.  **EVL Tail Folding (显式向量长度)：**
    - 不再生成标量 Epilogue。
    - 生成带有 `AVL` 控制的循环，利用 RISC-V 的 `setvl` 指令处理尾部。
2.  **特定的 Recipes (配方)：**
    - 引入 `VPWidenIntrinsicRecipe` 等，绕过 `shufflevector` 的限制。
    - 将 `Reverse` 模式直接映射为 `vp.reverse` intrinsic。
    - 将 `Stride` 模式识别并折叠为 `vp.strided.load` (对应 `vlse` 指令)。

---

## 4. 完整的向量化流水线 (Pipeline)

当开启 `-O3` 时，LLVM 的处理顺序如下：

1.  **Loop Vectorizer (VPlan-backed):**
    - 优先尝试循环向量化。
    - 若是 RISC-V，尝试构建支持 EVL 的 VPlan。
    - 如果代价过高或依赖无法解决，则放弃。
2.  **Loop Unroll:**
    - 如果 LV 放弃，或者为了进一步优化，展开循环体。
3.  **SLP Vectorizer:**
    - 作为“扫地僧”进场。
    - 扫描展开后的代码或线性代码块，打包剩余的标量操作。

---

## 5. 总结结论
- **SLP** 负责把代码里本就存在的**空间并行**找出来。
- **Loop Vectorizer** 负责把循环里的**时间并行**转换成空间并行。
- **VPlan** 是为了解决**变长向量**（RVV/SVE）和**复杂控制流**而引入的显式规划层，它解决了中端 IR 过于通用而无法描述硬件特性（如 EVL, Predication）的问题。
