# qemu usage and options

主要是介绍 qemu 的一些使用方式，一些选项的介绍，方便自己之后查。

使用 qemu 最重要的一点是理解 qemu 的前端和后端的概念，qemu 的前端，指的是在 qemu 中模拟的硬件，他们对应着 qemu 中实际的硬件模型，qemu 的后端只的是物理机上分配的资源，即在物理机上抽象出了什么资源给前端使用，两者需要做到的是一一对应。在老版的接口中，使用 `-drive` 实现同时指定前端和后端，在新版的接口中，使用 `-chardev` 这种方式指定后端，用 `-device` 的方式指定前端，两种方式在 qemu 中都能够使用。

## qemu 前端可用的设备

qemu 前端可用的设备能通过命令查出来，查出来之后可以再进行设置。

## accel

这个选项指定使用什么进行加速模拟，默认的采用 qemu 的 tcg 进行模拟，也就是软件模拟，也可以执行为 kvm 模拟，使用 kvm 来为模拟加速。

## cpu

有关 cpu 可以设置的选项很多，可以设置超线程、核数、socket、numa 等等，具体可以查手册进行测试。

## -boot

> Specify boot order drives as a string of drive letters. Valid drive letters depend on the target architecture. The x86 PC uses: a, b (floppy 1 and 2), c (first hard disk), d (first CD-ROM), n-p (Etherboot from network adapter 1-4), hard disk boot is the default. To apply a particular boot order only on the first startup, specify it via once. Note that the order or once parameter should not be used together with the bootindex property of devices, since the firmware implementations normally do not support both at the same time.

这里关注的主要是可以通过设置 boot 的选项对从什么地方启动进行配置。

## -device

这是 qemu 中创建前端的方式，可以通过这个进行使用。

用于同时指定前后端。里面会有 id 这个选项，这是方便 qemu 命令行中进行引用。前端在 guest os 的命名应该会根据使用的`interface`接口和`index`来进行命名。

## -fsdev

这个选项很有意思，是实现主机之间的目录和 guest 之间的目录进行共享的，可以查看具体的选项进行设置。

## -nographic

不开启图形显示。

## -netdev 

指定主机网络后端的时候用的。主要是这里面有个 type 选项，指定了不同的 qemu 和主机的通信方式。从 gpt 抄下，大概的解释是：

| 类型 (`type=`)   | 作用简介                                                     | 典型用途                                               |
|------------------|--------------------------------------------------------------|--------------------------------------------------------|
| `user`           | 用户态 NAT，虚拟机能访问外网，外部无法主动访问虚拟机         | 最简单、无需配置，适合开发测试                         |
| `tap`            | 使用 host 的 tap 接口，允许虚拟机和 host 在同一网络层通信     | 适合需要虚拟机获得独立 IP 的场景                       |
| `bridge`         | 连接到 host 上的桥接接口，虚拟机如同物理主机一样存在         | 用于虚拟机完全暴露在局域网中（生产部署等）             |
| `socket`         | 用 socket 方式连接多个 QEMU 实例（点对点或多播）             | 虚拟机集群内部通信                                     |
| `stream`         | TCP 流通信方式，用于传输网络数据流                           | 通常用于嵌入式模拟器中与远程设备通信                   |
| `vhost-user`     | 用于与用户空间 vhost 前端通信（如 DPDK、VPP）                | 高性能网络虚拟化（NFV）应用                            |
| `vhost-vdpa`     | 利用 VDPA 加速网络（结合硬件支持）                           | 高性能、低延迟网络                                     |
| `none`           | 不配置网络后端                                               | 某些只需要模拟硬件的虚拟机场景                         |


## -chardev

字符设备后端。guest os 的串口输出可以重定向到设备中。

设备可以是双向管道、伪终端、socket 链接等等。

## Boot Image or Kernel specific

-bios 指定 bios， -append 指定内核参数。

## -serial dev

本质是创建 chardev 并绑定到 guest 前端中串口的语法糖。

## -monitor dev

和上面的类似，只是把 qemu 虚拟机的终端挂在到什么位置。

## -D -d

一些 d 开头的选项都是指定日志输出的。

## -plugin

加载 qemu 插件。

## loader

加载程序到指定位置。

## Disk Images

指的是 qemu 支持哪些 image，主要的就是 raw，就是普通，然后就是许多其他的虚拟机格式。支持 virtual FAT 对主机的目录访问，支持 sshfs 对远程镜像的访问。

## qemu-img

对各种不同形式的格式进行转换。

## deamon

后台运行

## pidfile

将 qemu 运行的 pid 记录到指定的文件中，在需要结束的时候可以使用 pkill 命令去杀。







