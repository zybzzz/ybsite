# MLIR 初探

学 triton，本质还是 mlir，看了下 mlir。

## 看代码

代码往往进行了很多层的封装。mlir 代码中包含了很多 profiler，可以根据这些 profiler 的一些提示来看懂代码在干什么。代码结构还是很清晰的 `include` 中包含的是定义的头文件，`lib` 中都是具体的实现。

## 本质

本质就是多层次的编译过程，跟传统编译一样，parser 吃进来然后做分析。parser 在吃的时候并不关注到底现在文件中表示的是哪种方言，具体是哪种方言还有优化都是 pass 干的。

## transform vs conversion

这是两类 pass, transform 更加侧重于对于优化的 pass 而 conversation 更加侧重于 lower 的 pass。当然 pass 还包含了很多，包括分析 pass 等等。

## 代码布局和 tablegen

整体的 mlir 项目代码都是一个通用的结构，虽然有各种方言的实现，但是各种方言的实现都会在 Dialect 相关的目录下，各种方言相关的 Pass 也都是在方言的目录下。`lib/transform` 下都是一些各种方言通用的 pass 实现。

tablegen 是一个生成器，用来生成一些需要的类定义。在 `include/tablegen` 下面也会有 Pass 的定义，这些只是 `.td` 的信息载体，是给 `mlir-tablegen` 程序用的，目的也是用作生成最终的 Pass。

## trait interface 

都是指定某个 op 有某种属性，支持某个操作，这样 pass 就能进行判断执行某些操作。

## action

注入的动作，在 pass 流水线上可以注入自己想要的操作。


## datalayout interface

数据的内存布局相关。

## disgnose

用于支持诊断信息的输出。

## DAG-DAG rewrite

优化手段，实现在 pass 中？

## 转换合法性的判断

在方言做 lower 的时候，需要判断方言中哪些需要 lower，对于已经合法的就不用 lower，不合法的要 lower。