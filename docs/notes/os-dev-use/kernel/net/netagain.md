# Linux 内核网络、I/O 与中断子系统深度解析笔记

这份文档整理了关于 Linux 同步/异步 I/O、Epoll 原理、网络协议栈路径、中断处理（SoftIRQ）以及内核队列机制的深度问答。

---

## 1. 同步阻塞 Read 与中断唤醒机制

### 核心问题
当一个同步阻塞的 `read` 被调用时，进程如何休眠？硬件中断发生后，内核代码如何在何处将进程唤醒？

### 核心流程
1.  **睡眠路径 (Process Context)**:
    * 用户调用 `read()`。
    * 内核驱动（如 TTY）调用 `add_wait_queue()` 将当前进程加入 `wait_queue_head_t`。
    * 设置进程状态为 `TASK_INTERRUPTIBLE`。
    * 调用 `schedule()` 让出 CPU，进程在此处“卡住”。
2.  **唤醒路径 (Interrupt Context)**:
    * 硬件触发 IRQ -> ISR (顶半部) 读取硬件寄存器。
    * 数据推送到内核缓冲区。
    * 调用 `wake_up_interruptible(&tty->read_wait)`。
3.  **调度核心**:
    * `wake_up` -> `__wake_up_common` -> `try_to_wake_up`。
    * 获取锁，将进程状态改回 `TASK_RUNNING`，加入 CPU 的运行队列 (Runqueue)。
    * `schedule()` 返回，进程继续执行。

### 关键文件位置
* **睡眠**: `drivers/tty/n_tty.c` (`n_tty_read`)
* **中断处理**: `drivers/tty/serial/8250/8250_port.c`
* **唤醒逻辑**: `kernel/sched/wait.c` (`__wake_up`) 和 `kernel/sched/core.c` (`try_to_wake_up`)

---

## 2. Epoll 编程样例与 LT/ET 模式

### 核心代码结构 (TCP Echo Server)
* **创建**: `epoll_create1(0)`
* **注册**: `epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &ev)`。底层操作红黑树。
* **等待**: `epoll_wait(epfd, events, MAX, -1)`。底层检查就绪链表 (rdllist)。

### 关键概念
* **LT (Level Triggered)**: 默认模式。只要缓冲区有数据，每次 `epoll_wait` 都会通知。
* **ET (Edge Triggered)**: 高性能模式。只在数据从无变有时通知一次。必须配合非阻塞 I/O (`O_NONBLOCK`) 并循环读取直到 `EAGAIN`。
* **数据结构**:
    * **红黑树 (RB-Tree)**: 存储所有监听的 FD，O(logN) 增删查。
    * **就绪链表 (Ready List)**: 存储当前有事件的 FD，O(1) 获取。

---

## 3. Epoll 的本质：同步还是异步？

### 结论
**Epoll 是同步 I/O (Synchronous I/O)。**

### 原因解析
虽然 `epoll_wait` 提供了事件通知的 Batching（批量通知），但**数据拷贝 (Data Copy)** 阶段依然是同步的。
1.  **Notification**: `epoll_wait` 只是告诉你“谁有数据”。
2.  **Copying**: 进程必须亲自调用 `read()`。此时 CPU 必须介入执行内存拷贝（Kernel Buffer -> User Buffer），进程在此期间无法执行其他逻辑。

### 对比异步 (io_uring)
* **Epoll**: 等通知 -> 自己去搬运数据 (read)。
* **io_uring**: 下达指令 -> 内核/DMA 在后台搬运数据 -> 收通知 (Completion)。

---

## 4. Epoll 内核到用户态的数据拷贝

### 代码位置
`fs/eventpoll.c` -> `ep_send_events_proc`

### 拷贝逻辑
1.  遍历内核的就绪链表 (`rdllist`)。
2.  将内核的 `struct epitem` 转换为用户态的 `struct epoll_event`。
3.  使用 **`__put_user`** 宏（编译为 Store 指令）将数据写入用户传入的数组内存。
4.  这是一个在系统调用上下文中的**同步循环**。

### 体系结构视角
* 利用了 Write Combine 和 CPU Store Buffer。
* 对 Cache 友好（顺序写入用户态连续内存）。

---

## 5. Poll 与 Epoll 的区别 (Batching vs Overhead)

### 误区纠正
Poll 也能处理 Batch，但它的 Batch 是**“重型”**的。

| 特性 | Poll | Epoll |
| :--- | :--- | :--- |
| **状态维护** | **无状态 (Stateless)**。每次 syscall 都要把所有 FD 从用户态拷到内核态。 | **有状态 (Stateful)**。内核维护红黑树，无需重复传递 FD。 |
| **遍历方式** | **O(N)**。内核线性扫描所有 FD 的等待队列。 | **O(1)**。直接查看就绪链表 (Ready List)。 |
| **拷贝开销** | 巨大 (User <-> Kernel 双向全量拷贝)。 | 极小 (仅拷贝就绪的事件)。 |
| **适用场景** | 连接数少，活跃度高。 | 连接数巨大 (C10K+)，活跃度低。 |

---

## 6. Page Cache vs Network Buffer

### 职责分离
* **Page Cache**:
    * **用户**: 文件系统 (VFS, ext4), 块设备。
    * **目的**: 缓存磁盘文件，减少磁盘 I/O。
    * **索引**: `inode` + `offset`。
* **Socket Buffer (`sk_buff`)**:
    * **用户**: 网络协议栈 (TCP/IP)。
    * **目的**: 缓冲网络流，适配速率差异。
    * **特性**: 临时性强，用完即毁。

### 交互例外 (Zero Copy)
* `sendfile` / `splice`: 网卡驱动通过 DMA 直接读取 Page Cache 中的物理页发送数据，跳过 Socket Buffer 的数据拷贝，实现零拷贝。

---

## 7. VFS (Virtual File System) 的分发角色

### VFS 架构
VFS 是抽象层，通过 `struct file_operations` (虚函数表) 实现多态。

* **路径 A (磁盘)**: `write` -> `vfs_write` -> **Ext4 write** -> **Page Cache** -> Block Layer。
* **路径 B (Socket)**: `write` -> `vfs_write` -> **Socket write** -> **TCP/IP Stack** (跳过 Page Cache/Block Layer)。

VFS 对于网络 Socket 来说，只是一个薄薄的入口适配器，随后就进入了独立的网络子系统。

---

## 8. 网络子系统的“九曲十八弯” (队列与缓冲)

### 为什么有这么多队列？
为了解耦、适配速率差异 (Hardware vs Software) 以及流控 (QoS)。

### 1. 接收路径 (RX Path: Bottom -> Up)
1.  **NIC RX Ring Buffer (硬件/DMA)**:
    * 固定大小环形数组。
    * 溢出表现: `ethtool -S` 显示 `rx_missed_errors` / `dropped`。
2.  **Per-CPU Backlog (软中断队列)**:
    * 内核 `softnet_data` 里的链表。
    * 溢出表现: `/proc/net/softnet_stat` 第二列增加。
3.  **Socket Receive Buffer (Recv-Q)**:
    * 应用层 `read` 还没拿走的数据。
    * 溢出表现: TCP Zero Window，`ss -nt` 中 `Recv-Q` 堆积。

### 2. 发送路径 (TX Path: Top -> Down)
1.  **Socket Send Buffer (Send-Q)**:
    * 应用层 `write` 写入的地方。
    * 满载表现: `write` 阻塞或返回 `EAGAIN`。
2.  **Qdisc (排队规则)**:
    * 流量控制 (TC)，如 `pfifo_fast`, `HTB`。
    * Bufferbloat 的主要发生地。
3.  **NIC TX Ring Buffer**:
    * 驱动层，指向即将由 DMA 发送的数据。

---

## 9. 丢包排查与中断亲和性 (Affinity)

### 丢包排查顺序
* **RX**: 从下往上查 (Ring -> SoftIRQ -> Protocol -> Socket)。
* **TX**: 从上往下查 (Socket -> Qdisc -> Driver)。
* **工具**: `ethtool -S`, `netstat -s`, `ss -mp`, `tc -s qdisc`, `dropwatch`.

### 中断亲和性 (RSS)
* **问题**: 怎么知道哪个核处理哪个包？
* **RSS (Receive Side Scaling)**: 网卡硬件计算五元组 Hash -> 映射到 RX Queue 索引 -> 触发对应的 MSI-X 中断向量 -> 内核根据 `/proc/irq/N/smp_affinity` 决定由哪个 CPU 处理。

### 跨核处理 (Cross-Core) 避免
* **Locality**: 目标是让“协议栈处理”和“App 读取”在同一个 CPU 上，保暖 L1/L2 Cache。
* **手段**:
    * **RPS**: 软件模拟多队列分发。
    * **RFS (Receive Flow Steering)**: 内核自动感知 App 所在的 CPU，将软中断引导过去。
    * **Manual Pinning**: 手动绑定网卡中断和 App 进程到同一组 CPU。

---

## 10. SoftIRQ (软中断) 深度解析

### 特性
1.  **编译时确定**: 只有固定的几个号 (如 `NET_RX`, `NET_TX`)，不能动态增加。
2.  **Per-CPU**: 虽然号一样，但每个 CPU 有独立的实例和 pending 位图。
3.  **网络相关**:
    * `NET_RX_SOFTIRQ`: 核心重活（NAPI 轮询、协议栈处理）。
    * `NET_TX_SOFTIRQ`: 主要是发送后的内存清理 (GC) 和唤醒队列。

---

## 11. Per-CPU 队列的内存模型

### 结论
* **队列头 (`softnet_data`)**: 是 Per-CPU 变量，编译时确定，内存固定。
* **队列身 (`sk_buff` 链表)**: 是运行时动态分配的，长度可变。
* **长度限制**: 运行时通过 `sysctl net.core.netdev_max_backlog` 动态配置，不是编译死的。

### 结构
`DEFINE_PER_CPU` 定义了 `struct softnet_data`，其中包含 `input_pkt_queue` 的链表头指针。

---

## 12. SoftIRQ 的上下文与调度

### 运行机制 (Hijack)
SoftIRQ 通常**没有进程上下文**，它“寄生”在硬中断退出的路径上。
1.  **硬中断结束 (`irq_exit`)**: 检查 `pending` 位图。
2.  **借用栈**: 借用当前 CPU 的 **IRQ Stack** (硬中断栈)。
3.  **抢占**: 此时不需要调度器介入，直接抢占当前 CPU 执行。

### ksoftirqd (软中断守护线程)
* **触发**: 当软中断处理太久 (>2ms) 或太多，内核为了防止用户态饿死，停止“寄生”模式。
* **机制**: 唤醒 `ksoftirqd/n` 内核线程。
* **本质**: SoftIRQ **临时绑定/借用** 了 `ksoftirqd` 线程的 **进程上下文** 和 **内核栈**。
* **后果**: 此时 SoftIRQ 变成了普通的线程，受 CFS 调度器管理，可以被抢占或睡眠。

---

## 13. io_uring 的位置与环形队列

### 两个维度的 Ring
1.  **Data Plane Ring**: 底层的 `RX Ring`, `Recv-Q` (存数据包)。
2.  **Control Plane Ring**: `io_uring` 的 `SQ/CQ` (存读写指令)。

### io_uring 位置
* 位于 **App** 和 **Socket Recv-Q** 之间。
* 它指挥内核从 Socket Buffer 搬运数据到 User Buffer。
* **优势**: 通过 Batching (SQE) 减少系统调用次数，通过 Pipeline 提高并发。

### 终极形态: AF_XDP + io_uring
* 使用 `AF_XDP` Socket 可以绕过内核协议栈 (Backlog/TCP/IP)。
* 网卡 DMA 直接对接用户态内存 (UMEM)。
* 此时才是真正的“Ring Buffer 贯穿始终”（Hardware Ring <-> User Ring）。
