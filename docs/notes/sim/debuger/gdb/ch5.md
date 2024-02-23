---
description:Rough reading of debugging in gdb chapter 5
---
# Rough reading of debugging in gdb chapter 5

## 5.1 Breakpoints, Watchpoints, and Catchpoints

主要讲述断点、监视点、捕获点的设置。以及在设置这些点的时候能够附加的一些 command 方法，还有为断点增加条件判定。

## 5.2 Continuing and Stepping

讲述如何继续向下进行调试。

## 5.3 Skipping Over Functions and Files

讲述在调试过程中能够设置忽视函数或者忽视某个文件中的全部代码，调试过程就不会遇到这些函数停下。

## 5.4 Signals

在 gdb 中接受信号并进行相关的处理。

## 5.5 Stopping and Starting Multi-thread Programs

多线程调试时候的模式设定。
