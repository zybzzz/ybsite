# MLIR 基本逻辑

## 再探 tablegen

llvm 中的 tablgen 本质上使用的都是一个程序，因为 tablegen 本身的语法是固定的，实际上所有特别的 tablegen 都是调用基本的 llvm 基本解析器进行文件解析，然后注册一个回调函数进行自己独特的逻辑，MLIR 就是这样的实现。

```bash
├── AttrOrTypeDefGen.cpp
├── AttrOrTypeFormatGen.cpp
├── AttrOrTypeFormatGen.h
├── BytecodeDialectGen.cpp
├── CMakeLists.txt
├── DialectGen.cpp
├── DialectGenUtilities.h
├── DirectiveCommonGen.cpp
├── DocGenUtilities.h
├── EnumPythonBindingGen.cpp
├── EnumsGen.cpp
├── FormatGen.cpp
├── FormatGen.h
├── LLVMIRConversionGen.cpp
├── LLVMIRIntrinsicGen.cpp
├── OmpOpGen.cpp
├── OpClass.cpp
├── OpClass.h
├── OpDefinitionsGen.cpp
├── OpDocGen.cpp
├── OpFormatGen.cpp
├── OpFormatGen.h
├── OpGenHelpers.cpp
├── OpGenHelpers.h
├── OpInterfacesGen.cpp
├── OpPythonBindingGen.cpp
├── PassCAPIGen.cpp
├── PassDocGen.cpp
├── PassGen.cpp
├── RewriterGen.cpp
├── SPIRVUtilsGen.cpp
├── TosaUtilsGen.cpp
└── mlir-tblgen.cpp
```

这些回调函数和对应的选项都实现在 `mlir/Tool`，这些选项也和各个 cmake 中调用的一致。每个不同的模块都会调用不同的选项实现自己想要的模块。

## pass pipeline

整体过程是先调用 parser 解析写的 `.mlir` 文件，这里并不解析 mlir 的 dialect， dialect 还是放到 pass 中解析。这边的代码好像考虑到了多线程，貌似会将一个文件拆到多个 buffer 中。解析 mlir 的过程设计三个概念，一个基本块为一个 block，多个 block 组成一个 region，一个 function 为一个 op。最后生成的结果是一个大的 op，包含了所有的信息，这就是为什么在后续对 pass 进行 run 的时候只有一个 op 被 run。

pass 流水线的构建是人工指定顺序的，先过分析 pass，后续的优化 pass 和 lower pass 都能使用到分析 pass 中的信息。pass 完全没有从多个中选一个最优的逻辑，完全就是按顺序来，因此顺序的指定是非常重要的。