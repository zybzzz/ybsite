# gem5 核心整体架构

这部分对 gem5 整体的架构进行解析，主要是想建立从 ISA 定义到 cpu 运行的整体视图。

## System 模块

System 模块主要建立的是对整个仿真系统的抽象，这个类对应的封装了整个系统级的配置和状态，包括处理器核心、内存系统、电源管理等等，不同的状态都被封装在这个类中，获取的时候可能也是通过这个类进行获取。
