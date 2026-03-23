# 异步

## 用"记一笔"的比喻理解异步

整个异步过程可以拆成三步：

1. **记一笔**——描述要做什么（创建 Future）
2. **别人拿去做**——执行器（Runtime/Executor）调度执行
3. **过来看看弄完没**——轮询（Poll）检查进度

Rust 的异步模型和 Tokio 的各个概念刚好对应到这三步上。

## Future：那张"记一笔"的纸条

`Future` 是一个 trait，代表一个**尚未完成的计算**。创建 Future 的时候什么都不会发生，它只是一张写好的纸条，描述了"要做什么"。

```rust
trait Future {
    type Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output>;
}

enum Poll<T> {
    Ready(T),    // 做完了，结果在这
    Pending,     // 还没做完，过会儿再来看
}
```

关键点：**Future 是惰性的**。光写 `async fn fetch_data()` 或者 `async { ... }` 只是创建了纸条，不会自动执行。

```rust
let future = fetch_data();  // 只是"记了一笔"，什么都没发生
```

## async/await：写纸条和等结果的语法糖

`async` 用来写纸条（创建 Future），`await` 用来等结果（驱动 Future 往前推进）。

```rust
// async fn 本质上返回一个 Future
async fn fetch_data() -> String {
    let response = make_request().await;  // 等这一步完成
    let body = read_body(response).await; // 再等这一步完成
    body
}
```

`await` 做的事情：

1. 调用 Future 的 `poll` 方法
2. 如果返回 `Poll::Ready(val)` —— 拿到结果，继续往下走
3. 如果返回 `Poll::Pending` —— **让出控制权**，去做别的事，等被通知了再回来 poll

这就像你去查看任务进度：做完了就拿结果，没做完就先去忙别的，别人做完了会叫你。

## Poll 与 Waker：怎么知道"弄完了"

不可能一直盯着纸条看（忙等待/busy-waiting），所以需要一个通知机制。这就是 `Waker` 的作用。

```text
第一次 poll
  └─ Pending → 注册 Waker（"做完了叫我"）
                  │
                  ▼
            底层 I/O 完成
                  │
                  ▼
            调用 waker.wake()（"嘿，好了！"）
                  │
                  ▼
            再次 poll
              └─ Ready(结果) → 拿到值
```

整个流程是**基于通知的**，不是定时轮询。Future 在返回 `Pending` 时会把 Waker 存下来，等底层操作完成后通过 Waker 通知执行器"该再 poll 我了"。

## Tokio Runtime：拿纸条去干活的人

光有纸条（Future）不够，需要有人拿着纸条去执行。Tokio 的 Runtime 就是那个"别人"。

```rust
#[tokio::main]
async fn main() {
    let result = fetch_data().await;
    println!("{}", result);
}
```

`#[tokio::main]` 展开后大致等价于：

```rust
fn main() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let result = fetch_data().await;
        println!("{}", result);
    });
}
```

Tokio Runtime 内部有几个关键角色：

| 角色 | 对应比喻 | 职责 |
| --- | --- | --- |
| **Executor** | 调度员 | 维护任务队列，决定 poll 哪个 Future |
| **Reactor（mio）** | 底层干活的人 | 监听 I/O 事件（epoll/kqueue），事件就绪时调用 Waker |
| **Spawned Task** | 一张张纸条 | 每个 `tokio::spawn` 创建一个独立任务 |

## tokio::spawn：多开几张纸条并发执行

```rust
async fn do_work() {
    // 两个任务并发执行，不是顺序执行
    let handle1 = tokio::spawn(fetch_from_db());
    let handle2 = tokio::spawn(fetch_from_api());

    let (r1, r2) = (handle1.await.unwrap(), handle2.await.unwrap());
}
```

`spawn` 就是把纸条交给执行器，执行器会在合适的时候 poll 它们。多个 spawn 的任务可以交替执行（并发），在多线程 Runtime 下甚至可以并行。

## 完整映射总结

```text
你的比喻              Rust 概念              Tokio 概念
─────────────────────────────────────────────────────────
记一笔                async { ... }          -
(描述任务)            → 创建 Future

纸条本身              Future trait            JoinHandle
(任务的描述)          (poll 方法)

别人拿去做            Executor                tokio::runtime
(有人执行)            (循环调用 poll)          (多线程调度器)

做完了叫我            Waker                   Reactor (mio)
(通知机制)            (wake() 回调)           (epoll/kqueue 事件通知)

过来看看弄完没        .await                  .await
(检查结果)            (poll → Ready/Pending)

同时记好几张纸条      -                       tokio::spawn
(并发多个任务)                                (提交多个 Future)
```

## 一个关键区别：协作式调度

Rust 的异步是**协作式**的，不是抢占式的。Future 必须主动让出控制权（在 await 点返回 Pending），执行器才能去 poll 别的任务。如果一个 Future 里跑了很长的同步计算而不 await，整个执行器就被堵住了。

```rust
// 错误示范：阻塞了执行器
async fn bad() {
    std::thread::sleep(Duration::from_secs(10)); // 同步阻塞！
}

// 正确做法：用异步版本
async fn good() {
    tokio::time::sleep(Duration::from_secs(10)).await; // 异步等待，让出控制权
}

// 或者把阻塞操作扔到专用线程
async fn also_ok() {
    tokio::task::spawn_blocking(|| {
        heavy_computation(); // 在独立线程跑，不堵执行器
    }).await.unwrap();
}
```

这就像你把纸条给了一个人，他一次只能看一张纸条。如果某张纸条上写着"原地站 10 秒"，他就卡住了，其他纸条都没人看。所以纸条上应该写"设个 10 秒闹钟，响了叫我"，这样他可以先去处理别的纸条。
