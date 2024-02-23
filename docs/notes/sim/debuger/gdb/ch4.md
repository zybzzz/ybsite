---
description:Rough reading of debugging in gdb chapter 4
---
# Rough reading of debugging in gdb chapter 4

第四章主要讲了程序在 gdb 上的启动过程，以及多种的调试程序的方式。下简要的根据目录介绍每个小结的内容。

## 4.1 Compiling for Debugging

编译用来给 gdb 调试的程序的时候需要启动的编译选项。

## 4.2 Starting your Program

如何在 gdb 中启动调试，gdb 中启动的调试实际上是启动了一个子进程来运行程序。

## 4.3 Your Program’s Arguments

如何传参或者通过设置 gdb 命令的方式来传递程序所需要的参数。

## 4.4 Your Program’s Environment

gdb 运行时环境和程序运行时环境，描述了在 gdb 中设置环境变量产生的影响。

## 4.5 Your Program’s Working Directory

描述了工作目录的设置。

## 4.6 Your Program’s Input and Output

描述了在 gdb 中调试的程序输入输出到何处，描述了输入重定向和输出重定向相关。

## 4.7 Debugging an Already-running Process

描述 gdb 附加到正在运行的进程，注意在第一次附加到正在运行的进程的时候，正在运行的进城会暂停运行，等待 gdb 的命令，同时 attach 这个命令是不能被重复的。

## 4.8 Killing the Child Process

如何杀死正在调试的进程。

## 4.9 Debugging Multiple Inferiors Connections and Programs

指定 gdb 在多个进程之间的切换以及多个进程的调试。

## 4.10 Debugging Programs with Multiple Threads

指定 gdb 对多个线程的调试。

## 4.11 Debugging Forks

指定 gdb 对父子进程的调试。

## 4.12 Setting a Bookmark to Return to Later

描述 gdb 从 checkpoint 中恢复，从中恢复的进程和之前的进程具有一样的虚拟地址分布。
