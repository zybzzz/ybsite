# qemu 目录树

qemu 的目录树非常复杂，只看名字理解很容易理解错，在这里记录一下方便以后翻起来找。

## 目录树结构

1. `include`:包含的头文件
2. `accel`：使用什么加速器来加速qemu，默认是 tcg，vcpu 的线程就是由加速器创建出来的。
3. `hw`、`include/hw`：描述的是 machine 的实现，各个厂商不同的 machine 在这里实现。
4. `target/{arch}`：目标体系结构的 cpu 实现。各种厂商，各种不同类型的 cpu 实现都在这里实现。包括访存的实现，tlb填充的细节差不多都在这个地方。
5. `include/hw/core`、`include/board.h`、`include/qdev-core.h`：这里的 core 指的是 qemu 核心模块的意思，指的是一些核心在这里声明。比如 TYPE_MACHINE TYPE_DEV 这种，都是在这些地方声明的。
6. `hw/core`：和上面对应，这里面提供的是一些核心的 class_init instance_init 方法。
7. `hw/{arch}`：厂商对应的 board 模型在这里实现。