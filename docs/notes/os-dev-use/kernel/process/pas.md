# 进程和调度

## fork vs vfork

vfork 省页表拷贝，等于和父进程还共用一个页表，父进程要等子进程好了才能继续向下

## 父进程先结束

父进程先结束的话，要找父进程继承儿子。

优先找同一个线程组内的，然后找 Subreaper 声明的，都没有直接挂到 init 上。

## 回收时机

子进程die 的时候，会向父进程发送 SIGCHLD 信号，取决于父进程怎么处理。

默认就是什么都不管，因为父进程自己的代码里可能写了wait。还能配置成 IGNORE，也就是直接释放掉子进程的资源。还可以自己注册回调处理。

## 多个子进程一起结束

多个子进程一起结束，会给父进程发多个 SIGCHLD，但是信号是 bitmap 表示的，会重叠起来。因此需要自己注册 handler轮询。

```c
void sigchld_handler(int sig) {
    int status;
    pid_t pid;

    while ((pid = waitpid(-1, &status, WNOHANG)) > 0) {
        // 成功回收了一个子进程 (pid)
        // 这里可以做一些简单的统计，但不要做复杂操作
    }
}
```

现代 linux 中引入了 signalfd，相当于信号直接写到 fd 中，有机会主线程再去处理。

## pid tid

内核只有 pid，不管是 fork clone 都会分配出新的 pid，内核看来线程进程没区别。只是对用户展示的时候，展示的是 TGID，也就是线程组的 id，应该是主线程的 id。fork 会造成进程树的向下拓展，clone 在创建线程的时候应该是同级别的拓展。

## 调度

可以近似分为主动被动。主动是内核接收到时钟中断的时候可能触发调度，被动是用户进行系统调用的时候可能触发调度。reschedule 有这么一个概念很难理解，其实就是一个标志位，表示某个进程要撤下来了。


## 一、 CFS 的核心原理：红黑树与 vruntime

CFS（Completely Fair Scheduler，完全公平调度器）试图模拟一个“理想的多任务 CPU”，让所有进程看起来像是在以各自的权重并行运行。其运作完全围绕核心变量 **vruntime**。

### 1. vruntime (Virtual Runtime)
vruntime 是进程已经运行的“虚拟”时间，它是经过权重调整后的时间，而非墙上时钟时间。

* **规则**：谁的 $vruntime$ 最小，谁就最“饥饿”，调度器就选择谁上 CPU 运行。
* **累加逻辑**：进程运行越久，$vruntime$ 越大，在红黑树中就会向右移动，将 CPU 让给 $vruntime$ 更小的进程。

### 2. 红黑树 (Red-Black Tree)
CFS 使用红黑树（自平衡二叉查找树）来组织运行队列 (`cfs_rq`)，取代了传统的链表。

* **键值 (Key)**：进程的 $vruntime$。
* **调度逻辑**：调度器永远选择树的**最左侧节点 (Leftmost Node)** 投入运行。

---

## 二、 Nice 值如何起作用？（权重系统）

Nice 值在 CFS 中不再代表固定的时间片，而是代表**权重 (Weight)**。

### 1. Nice 到 Weight 的映射
Nice 值每降低 1（优先级提高），权重增加约 25%（1.25 倍）。基准点是 Nice 0 = 1024。

| Nice 值 | Weight (权重) | 描述 |
| :---: | :---: | :--- |
| -20 | 88761 | 最高优先级 (极重) |
| -5 | 3121 | 高优先级 |
| **0** | **1024** | **基准 (普通)** |
| +5 | 335 | 低优先级 |
| +19 | 15 | 最低优先级 (极轻) |

### 2. vruntime 计算公式
这是 CFS 最关键的公式。进程在 CPU 上跑了物理时间 $\delta_{exec}$，它的 $vruntime$ 增加量为：

$$
vruntime += \delta_{exec} \times \frac{\text{Weight}_{\text{nice\_0}}}{\text{Weight}_{\text{process}}}
$$

即：

$$
vruntime += \delta_{exec} \times \frac{1024}{\text{Weight}_{\text{current}}}
$$

### 3. 实例解读
假设物理时间都过了 **20ms**：

* **Nice 0 (普通)**：权重 1024。$vruntime$ 增加 20ms。虚拟流逝速度 = 物理速度。
* **Nice -5 (高优)**：权重 ~3121。$vruntime$ 增加约 **6.6ms**。
    * *效果*：在红黑树看来它跑得很慢，因此能长期霸占最左侧位置，获得更多物理时间。
* **Nice +5 (低优)**：权重 ~335。$vruntime$ 暴涨 **60ms**。
    * *效果*：瞬间被踢到红黑树右侧，很久排不上号。

---

## 三、 所谓的“时间片”去哪了？

为了防止单纯依赖 $vruntime$ 导致交互式任务（如 UI 刷新）饿死，CFS 引入了动态调度周期。

### 1. 为什么需要调度周期？
如果只按 $vruntime$ 排序而无时间限制，长任务可能连续运行几百毫秒，导致需要高频响应的 UI 线程卡顿。

* **调度周期 (`sysctl_sched_latency`)**：定义了“在多长时间内，让队列里所有任务都轮一遍”。默认通常为 6ms 或 24ms。
* **分配公式**：每个进程能分到的物理时间配额为：

$$
\text{Time\_Slice} = \text{Period} \times \frac{\text{Weight}_{\text{process}}}{\sum \text{Weights}_{\text{all\_tasks}}}
$$

### 2. 最小粒度 (Min Granularity)
当任务数非常多时（如 1000 个），切分出的时间片会过小导致上下文切换风暴。

* **`sysctl_sched_min_granularity`**：默认约 0.75ms。
* **兜底机制**：一旦 $(\text{Period} / \text{TaskCount}) < \text{MinGranularity}$，内核会强行拉长调度周期（$\text{Period} = \text{TaskCount} \times \text{MinGranularity}$），牺牲响应速度以保证系统不崩溃。

---

## 四、 内核如何权衡“负载均衡”与“亲和性”？

内核需要在 **负载均衡 (Balance)** 和 **缓存亲和性 (Affinity)** 之间做权衡。

### 1. 调度域层级 (Hierarchical Scheduling Domains)
内核根据物理距离划分层级，距离越远，迁移代价越大。

* **Level 1: SMT 域 (超线程)**
    * **场景**：同物理核的两个超线程。共享 L1/L2。
    * **策略**：**积极均衡**。迁移代价极低，只要有空闲就偷任务填满流水线。
* **Level 2: MC 域 (多核同插槽)**
    * **场景**：同芯片不同物理核。共享 L3 (LLC)。
    * **策略**：**懒惰均衡**。只有负载差距大时才迁移，避免 L1/L2 失效。
* **Level 3: NUMA 域 (跨 Socket)**
    * **场景**：跨 CPU 插槽。只共享内存总线。
    * **策略**：**极度保守**。除非一端快压垮而另一端完全空闲，否则不迁移，保护内存带宽。

### 2. 迁移机制
* **Pull 模型 (Idle Balance)**：CPU 空闲时，主动从繁忙 CPU（先近后远）“偷”任务。
* **Push 模型 (Periodic Balance)**：时钟中断定期巡检，若发现自己太忙且邻居太闲，强制将任务推过去。

---

## 五、 下一步：资源隔离 (Cgroups)

在理解了 CFS 和负载均衡后，针对容器化（Docker/K8s）场景，通常有更高级的限制需求：

1.  **限制 CPU 使用率 (如 50%)**：通过 **CFS Quota** (`cpu.cfs_quota_us`) 实现。
2.  **绑核 (CPU Affinity)**：通过 **CPU Set** (`cpuset`) 实现，将进程隔离在特定核上，避免干扰。

## 主动调度

在系统调用的时候，根据条件可能会被挂到资源的等待队列中，然后触发调度。
