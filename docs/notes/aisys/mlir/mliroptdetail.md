# mliropt 的过程以及其他细节

整个优化过程参考 mlir 论文的过程。

## tablgen 再探

tablegen 中的信息会被抽取并且封装到 `include/Tablgen` 的类中，由 tablgen 的工具生成各种后续需要使用到的东西。其中比较重要的是 Opbuilder，他往往在 dialect 的 tablegen 中有定义，这个东西很重要，在后续的 mliropt 运行过程中，解析 `.mlir` 的 parser 会利用 opbuilder 创建 op。

## 目录结构

`include/IR` 包含了 MLIR 定义的核心概念。各个 diatect 中的 transform 目录表示的是优化，transformop 目录表示的是 lower。

## region

region 是一种灵活的结构，可以包含多个基本块。更多的定义有待探索。

## mliropt 过程

解析 `.mlir` 文件，解析的过程中会根据 opbuilder 不断的创建 op，op都会被保存，一个 mlir module 是一个大的 operation，是 buildin op 定义的，成为 model op，这个过程中可能还会产生诊断。之后就是 pass，过完之后会进行验证。

## op state 

值得关注。