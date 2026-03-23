# 智能指针与内部可变性

## 借用 vs 智能指针

借用（`&T`）是临时访问别人的数据，不拥有所有权。智能指针则**拥有**数据，并通过实现 `Deref` 和 `Drop` trait 提供自动解引用和自动释放的能力。

| | `&T` | 智能指针 |
| --- | --- | --- |
| 所有权 | 无，借用 | 有 |
| 生命周期 | 受借用规则约束 | 自己管理，drop 时释放 |
| 数据位置 | 不决定 | 取决于具体类型 |

## Box\<T\>：堆分配 + 单一所有权

最基础的智能指针，把数据放到堆上，拥有唯一所有权。

```rust
let x = Box::new(5);         // 5 放到堆上
println!("{}", x);            // 自动解引用，像用普通值一样
```

### Box 解决的三个问题

**编译期大小未知的类型**（递归类型）：

```rust
// 编译错误：编译器算不出大小（无限递归）
enum List {
    Cons(i32, List),
    Nil,
}

// 用 Box 打断递归，大小固定为一个指针
enum List {
    Cons(i32, Box<List>),
    Nil,
}
```

**大数据避免栈拷贝**：

```rust
let big = Box::new([0u8; 1_000_000]); // 1MB 放堆上
let big2 = big;  // 转移所有权只拷贝一个指针，而非 1MB
```

**trait 对象需要堆分配**：

```rust
let animal: Box<dyn Animal> = Box::new(Dog {});
```

### Box::leak：主动放弃释放，换取 'static 生命周期

`Box::leak` 消耗一个 `Box<T>`，返回 `&'static mut T`。它阻止 `Box` 的析构函数运行，堆内存不会被自动释放，数据在程序的整个生命周期内一直存在。

```rust
let x = Box::new(String::from("hello"));
let static_ref: &'static mut String = Box::leak(x);
// x 的所有权被消耗，堆内存不会被释放
// static_ref 是一个 'static 生命周期的可变引用，程序运行期间永远有效
static_ref.push_str(" world");
```

核心转换：`Box<T>` → `&'static mut T`。本质是一种"合法的内存泄漏"——告诉编译器这块堆内存不需要自动回收。

**典型使用场景：**

- **运行时创建全局数据**：在运行时计算出配置信息，需要作为 `&'static` 引用被各处使用。比 `lazy_static` / `OnceLock` 更直接
- **`String` → `&'static str`**：动态生成的字符串需要传给只接受 `&'static str` 的 API（常见于 FFI 绑定）
- **FFI 交互**：将 Rust 对象传给 C 代码时，先 `leak` 阻止 Rust 回收，等 C 用完后通过 `Box::from_raw` 重新接管并释放
- **程序级生命周期数据**：数据需要伴随程序直到退出，手动 `drop` 反而浪费 CPU，直接 `leak` 让操作系统在进程退出时统一回收

```rust
// 典型用法：运行时生成 &'static str
fn make_static_str(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

// 配合 Box::from_raw 可以"找回"泄漏的内存
let x = Box::new(42);
let raw: *mut i32 = Box::into_raw(x);  // 类似 leak，但返回原始指针
// ... 传给 FFI 或其他用途 ...
let x = unsafe { Box::from_raw(raw) };  // 重新接管，离开作用域时正常释放
```

## Rc\<T\>：单线程共享所有权

Rust 的所有权规则要求一个值只有一个所有者，但有些数据结构天然需要多个所有者（图、DAG、共享节点的树）。`Rc`（Reference Counted）通过引用计数实现共享所有权。

```rust
use std::rc::Rc;

let a = Rc::new(String::from("hello"));
let b = Rc::clone(&a);  // 引用计数 → 2，不是深拷贝
let c = Rc::clone(&a);  // 引用计数 → 3

println!("{}", Rc::strong_count(&a)); // 3
// a, b, c 都能读同一份数据
// 最后一个被 drop 时，数据才释放
```

`Rc::clone()` 只是增加引用计数（开销极小），不是克隆数据。

### 共享所有权 vs 借用：为什么需要 Rc

借用（`&T`）只是临时访问别人的数据，数据的生死由原始所有者决定。`Rc` 则是真正的**共享所有权**——每个 `Rc` 都是"合伙人"，数据的生死由所有合伙人共同决定。

**借用做不到的事：**

当多个结构体需要长期持有同一份数据时，借用会陷入生命周期困境：

```rust
struct Config { port: u32 }

struct ModuleA<'a> {
    cfg: &'a Config,
}

fn setup() -> ModuleA<'static> {
    let cfg = Config { port: 8080 };
    let a = ModuleA { cfg: &cfg };
    a  // ❌ 编译错误：cfg 是局部变量，函数结束就死了，a 借的东西没了
}
```

借用要求你明确写出谁比谁活得久。如果 `ModuleA` 想在函数结束后继续存在，它借用的 `Config` 就必须在函数外面就存在。在复杂的图结构中，你往往无法预知哪个节点会先被删除。

**Rc 的解法：**

```rust
use std::rc::Rc;

struct Config { port: u32 }

struct ModuleA {
    cfg: Rc<Config>,  // 没有生命周期标注
}

fn setup() -> ModuleA {
    let cfg = Rc::new(Config { port: 8080 }); // 数据搬到堆上，引用计数 = 1
    let a = ModuleA { cfg: Rc::clone(&cfg) }; // 引用计数 = 2
    a  // ✅ 局部变量 cfg 被 drop（计数 -1），但 a 里的 Rc 还持有（计数 = 1）
}
```

注意 `ModuleA` 的定义和 `setup` 的返回值中都**没有生命周期标注**。`Rc<T>` 本身就是一个拥有所有权的结构体（内部通过指针指向堆内存），传递 `Rc` 是所有权转移或共享，不是借用，自然不需要 `'a`。

**Box 也不够的场景：**

`Box<T>` 是唯一所有权，当多个节点需要指向同一个节点时就不够用了：

```text
单链表（Box 够用）：A → B → C     每个节点只有一个所有者
共享节点（需要 Rc）：A → C ← B    C 有两个所有者，Box 做不到
```

当数据结构从"树"变成"图"（出现多对一的指向关系），就是 `Box` 退休、`Rc` 上岗的信号。

### Rc 的限制

- **仅单线程**，不能跨线程传递
- **默认不可变**，多个 `Rc` 共享意味着多个"所有者"，允许可变会破坏安全性
- 需要可变性时配合 `RefCell` 使用

### Weak\<T\>：防止循环引用

#### Rc 的堆内存布局：双重计数器

使用 `Rc<T>` 时，堆上实际分配的是一个 `RcBox` 结构，包含三部分：

```text
┌─────────────────────────┐
│  strong_count (强引用计数) │  ← Rc 的数量
│  weak_count   (弱引用计数) │  ← Weak 的数量
│  data: T                 │  ← 实际业务数据
└─────────────────────────┘
```

- **强引用计数**：记录有多少个 `Rc` 指向它。只要 `strong_count > 0`，数据 `T` 就保证存活。
- **弱引用计数**：记录有多少个 `Weak` 指向它。弱引用不影响数据 `T` 的生命周期。

#### 销毁（Drop）与释放（Deallocate）的区分

这是理解 `Weak` 工作原理的关键——数据的析构和内存的释放是**分阶段**进行的：

**第一阶段：销毁数据 T（`strong_count` 归零时）**

当最后一个 `Rc` 被 drop，强引用计数变为 0。Rust 立即调用 `T` 的 `drop` 函数，清理 `T` 持有的所有资源（文件句柄、网络连接、其他 `Rc` 等）。但此时堆上的 `RcBox` 内存块本身**不会被回收**，因为还有 `Weak` 指针需要读取计数器。

**第二阶段：释放堆内存（`strong_count` 和 `weak_count` 全部归零时）**

当所有 `Weak` 指针也消失后，弱引用计数归零。此时整块 `RcBox` 内存才真正还给操作系统。

为什么不在第一阶段直接释放整块内存？因为 `Weak` 指针需要一个有效地址来读取 `strong_count`，以判断数据是否还存活。如果直接释放，`Weak` 就会变成悬垂指针，`upgrade()` 时读到随机内存，违反内存安全。留着计数器，`Weak` 就能优雅地发现"强引用是 0，数据已经没了"，然后返回 `None`。

#### 循环引用问题

循环引用发生在两个对象互相持有对方的 `Rc`：

```text
A ──Rc──→ B
↑              │
└──Rc───┘
```

A 想释放，得等 B 释放（因为 B 手里有 A 的强引用）；B 想释放，得等 A 释放（因为 A 手里有 B 的强引用）。结果谁也释放不了，造成内存泄漏。

致命点不是"多占了几个字节"，而是**数据永远无法调用 `drop`，导致它关联的所有资源（大数组、文件、子节点）都无法回收**。

**破局：将其中一侧改为 `Weak`**

```text
父 ──Rc──→ 子（强引用，父拥有子）
子 ──Weak─→ 父（弱引用，子只是"观察"父）
```

当父节点的外部 `Rc` 被 drop 时，父的 `strong_count` 归零，触发 `drop`。在父节点析构的过程中，它持有的"指向子的 `Rc`"也被 drop，子的 `strong_count` 随之归零，子也触发 `drop`。整条链路正常清理。子节点的 `Weak` 不阻止父节点被销毁。

#### 常见 API

| API | 说明 |
| --- | --- |
| `Rc::downgrade(&rc)` | 将 `Rc<T>` 降级为 `Weak<T>`，增加弱引用计数，不增加强引用计数 |
| `weak.upgrade()` | 核心方法，返回 `Option<Rc<T>>`。数据还在返回 `Some`，已销毁返回 `None` |
| `Rc::strong_count(&rc)` | 获取当前强引用数量 |
| `Rc::weak_count(&rc)` | 获取当前弱引用数量 |

#### 基本用法

```rust
use std::rc::{Rc, Weak};

let strong = Rc::new(42);
let weak: Weak<i32> = Rc::downgrade(&strong);

// 使用前必须 upgrade，返回 Option<Rc<T>>
if let Some(val) = weak.upgrade() {
    println!("{val}");
}

drop(strong);  // 强引用归零，数据 T 被销毁
assert!(weak.upgrade().is_none()); // upgrade 失败，返回 None
// 此时 Weak 仍然存在，堆上计数器内存还在
// 等 weak 也被 drop 后，整块堆内存才真正释放
```

#### 典型场景：树结构的父子关系

树结构中子节点指向父节点用 `Weak`，避免父子互相引用导致计数永远不归零：

```rust
use std::rc::{Rc, Weak};
use std::cell::RefCell;

struct Node {
    value: i32,
    parent: RefCell<Weak<Node>>,       // 子 → 父：弱引用
    children: RefCell<Vec<Rc<Node>>>,  // 父 → 子：强引用
}
```

所有权链路应该是单向的有向无环图（DAG）。如果逻辑上必须出现环，确保环上至少有一个链接是 `Weak`。

## Arc\<T\>：多线程共享所有权

`Arc`（Atomic Reference Counted）是 `Rc` 的线程安全版本，引用计数使用原子操作。

```rust
use std::sync::Arc;
use std::thread;

let numbers = Arc::new(vec![1, 2, 3, 4, 5]);

let mut handles = vec![];
for i in 0..3 {
    let nums = Arc::clone(&numbers);  // clone 在循环内
    handles.push(thread::spawn(move || {
        println!("Thread {i}: {:?}", nums);
    }));
}

for h in handles {
    h.join().unwrap();
}
```

### Arc 的关键注意点

**`Arc::new()` 只接受 `T`，不接受 `&T`**。它必须拥有数据的所有权，才能在计数归零时释放：

```rust
let v = vec![1, 2, 3];

let a = Arc::new(v);    // 正确：v 的所有权移入 Arc

// Arc::new(&v) 技术上能编译（类型变成 Arc<&Vec>），但引用可能悬垂，没有意义
```

**先 `Arc::new()`，再在循环内 `Arc::clone()`**：

```rust
// 错误：每次循环都创建独立的 Arc，没有共享
for i in 0..8 {
    let a = Arc::new(data.clone()); // 每次都克隆数据
}

// 正确：循环外创建一次，循环内 clone（只增加引用计数）
let shared = Arc::new(data);
for i in 0..8 {
    let child = Arc::clone(&shared);
    thread::spawn(move || { /* 用 child */ });
}
```

### 不是所有多线程只读都需要 Arc

如果数据在外部作用域，且所有线程在数据销毁前一定结束，借用就够了，不需要 `Arc`。

**为什么 `thread::spawn` 不允许借用？**

`thread::spawn` 创建的线程理论上可能比当前函数活得久。编译器无法保证栈上的数据在线程结束前还存在，所以要求闭包捕获的变量必须是 `'static` 的（拥有所有权或全局数据）：

```rust
let array = vec![1, 2, 3, 4, 5];

thread::spawn(|| {
    println!("{:?}", array[0]);
    // ❌ 编译错误：closure may outlive the current function
    // 编译器不信任 array 在线程结束前还活着
});
```

**`thread::scope`：编译器信任的借用方案**

Rust 1.63 引入的作用域线程解决了这个问题。`scope` 保证在块结束前所有线程都已 join，编译器因此允许直接借用外部数据：

```rust
let array = vec![1, 2, 3, 4, 5];

std::thread::scope(|s| {
    for _ in 0..10 {
        s.spawn(|| {
            println!("{:?}", array[0]); // ✅ 直接借用，不需要 Arc
        });
    }
}); // 所有线程保证在这里结束，array 依然安全
```

**何时用借用，何时用 Arc？**

| 场景 | 方案 | 开销 |
| --- | --- | --- |
| 数据在外部、线程有明确的结束点 | `thread::scope` + 借用 | 零开销 |
| 全局静态数据（`static` / `const`） | 直接借用（天然 `'static`） | 零开销 |
| 线程生命周期不确定（线程池、异步任务） | `Arc<T>` | 原子计数器开销 |
| 动态图结构，节点在不同线程间流转 | `Arc<T>` | 原子计数器开销 |

原则：**能用借用解决的，不要用 `Arc`**。`Arc` 是为那些编译期无法确定生命周期边界的场景准备的。

### 闭包中的 move

`thread::spawn` 创建的线程可能比当前作用域活得更久，Rust 不允许闭包借用可能已失效的数据。`move` 把闭包捕获的外部变量的所有权转移进闭包：

```rust
let child_numbers = Arc::clone(&shared); // Arc clone
let offset: u32 = 3;                      // Copy 类型

thread::spawn(move || {
    // child_numbers: 所有权移入（Arc 的一份 clone）
    // offset: 因为是 Copy 类型，实际是拷贝进来
    let sum: u32 = child_numbers.iter().filter(|&&n| n % 8 == offset).sum();
});
```

## Cell\<T\> 与 RefCell\<T\>：内部可变性

Rust 的借用规则在编译期强制执行：要么一个可变引用，要么多个不可变引用。`Cell` 和 `RefCell` 把这个检查推迟到运行时，允许在持有不可变引用时修改数据。

### Cell\<T\>

适用于 `Copy` 类型，通过 `get`/`set` 整体替换值：

```rust
use std::cell::Cell;

let c = Cell::new(5);
c.set(10);             // 不需要 mut
println!("{}", c.get()); // 10
```

### RefCell\<T\>

适用于任意类型，通过 `borrow()` 和 `borrow_mut()` 获取引用，运行时检查借用规则：

```rust
use std::cell::RefCell;

let data = RefCell::new(vec![1, 2, 3]);

data.borrow_mut().push(4);           // 获取可变引用
println!("{:?}", data.borrow());      // 获取不可变引用

// 运行时 panic：同时存在可变和不可变借用
// let r1 = data.borrow();
// let r2 = data.borrow_mut(); // panic!
```

### Rc\<RefCell\<T\>\>：单线程共享 + 可变

`Rc` 解决"多个所有者"，`RefCell` 解决"需要可变"，组合起来就是单线程下的共享可变：

```rust
use std::rc::Rc;
use std::cell::RefCell;

let shared = Rc::new(RefCell::new(vec![1, 2, 3]));

let a = Rc::clone(&shared);
let b = Rc::clone(&shared);

a.borrow_mut().push(4);  // 通过 a 修改
b.borrow_mut().push(5);  // 通过 b 修改

println!("{:?}", shared.borrow()); // [1, 2, 3, 4, 5]
```

### 为什么要把检查推到运行期

Rust 的卖点是编译期静态检查，但 `Cell` 和 `RefCell` 却把借用检查推到了运行时。这不是设计缺陷，而是对静态分析局限性的务实补充。

**静态检查的天花板：**

编译器的 Borrow Checker 是保守的——它宁可误报也不放过任何潜在的不安全访问。但并非所有内存安全的代码都能在编译期被证明安全。典型的"编译器管不了"的场景：

- **环形数据结构**（图、双向链表）：多个节点互相引用，编译器找不出一个"大房东"来统一管理生命周期
- **内部可变性需求**：对象对外暴露 `&T`（多个模块共享只读访问），但内部需要更新状态（如访问计数器、缓存、日志）
- **回调与观察者模式**：事件源不知道有多少监听者，监听者可能在回调中修改共享状态

**编译器并非撒手不管：**

即便检查推到了运行时，编译器仍然在静态层面守住两道防线：

1. **生命周期收尾**：`borrow()` 和 `borrow_mut()` 返回的是守卫对象（`Ref` / `RefMut`），编译器通过静态分析保证守卫不会活得比 `RefCell` 本身更长，防止引用逃逸
2. **自动归还（RAII）**：守卫离开作用域时，编译器自动插入 `drop` 调用，将 `RefCell` 内部的借用计数器减 1。不需要手动"解锁"，不会因为忘记归还而死锁

**与 C 语言"手动检查"的本质区别：**

| | C 语言 | Rust RefCell |
| --- | --- | --- |
| 检查者 | 程序员自己写 `if (is_locked)` | `RefCell` 内部自动检查 |
| 忘了检查 | 静默数据损坏，可能几小时后才崩溃 | 编译器不给你绕过的机会，必须通过 `borrow` 接口 |
| 违规后果 | 未定义行为（UB） | 立即 `panic!`，错误锁定在违规现场 |
| 释放锁 | 手动，容易遗忘 | 自动（RAII），编译器保证 |

本质上，`Cell` / `RefCell` 是编译器和程序员之间的一份协议：程序员承诺逻辑上的正确性，编译器仍然守住生命周期和自动清理，运行时兜底捕获违规。

## Mutex\<T\> 与 RwLock\<T\>：多线程可变

### Mutex\<T\>

互斥锁，同一时刻只有一个线程能访问数据：

```rust
use std::sync::{Arc, Mutex};
use std::thread;

let counter = Arc::new(Mutex::new(0));

let mut handles = vec![];
for _ in 0..10 {
    let c = Arc::clone(&counter);
    handles.push(thread::spawn(move || {
        let mut num = c.lock().unwrap(); // 获取锁
        *num += 1;
        // 锁在 num 离开作用域时自动释放
    }));
}

for h in handles { h.join().unwrap(); }
println!("{}", *counter.lock().unwrap()); // 10
```

### RwLock\<T\>

读写锁，允许多个读者或一个写者：

```rust
use std::sync::RwLock;

let lock = RwLock::new(5);

// 多个读者可以同时持有
{
    let r1 = lock.read().unwrap();
    let r2 = lock.read().unwrap();
    println!("{}, {}", r1, r2);
}

// 写者独占
{
    let mut w = lock.write().unwrap();
    *w = 10;
}
```

适用于读多写少的场景，比 `Mutex` 有更高的读并发度。

### RwLock 与编译期借用规则的关系

`RwLock` 的规则（多读一写，读写互斥）和编译期的借用规则完全一致。区别在于：编译期检查要求**时序上的确定性**，而多线程场景下时序是不确定的。

**编译期借用检查依赖确定的控制流：**

编译器通过分析代码的控制流图（CFG），判断读和写在逻辑时间轴上是否存在交叠。只要编译器能证明"写操作结束后，读操作才开始"，就会放行。但当引用被传给 `thread::spawn` 后，控制流分叉成多条独立的执行路径，编译器无法预测哪个线程先执行、哪个后执行，因此直接拒绝编译。

**RwLock 把"禁止"变成"协调"：**

| | 编译期借用检查 | `RwLock` |
| --- | --- | --- |
| 规则 | 多读一写，读写互斥 | 多读一写，读写互斥 |
| 判定时机 | 编译时，基于控制流分析 | 运行时，基于实际执行时序 |
| 处理冲突 | 报错，拒绝编译 | 阻塞当前线程，等待锁释放 |
| 前提条件 | 时序必须静态可证明 | 时序可以是动态的、不确定的 |
| 运行时开销 | 零 | 原子操作 + 可能的线程阻塞 |

本质上，`RwLock` 是借用规则在多线程时间轴上的运行时实现：编译器管不了跨线程的执行时序，`RwLock` 通过阻塞机制在运行时强制保证同一时刻不会出现读写并发。`Mutex` 是其特例——不区分读写，所有访问都互斥，逻辑更简单但读并发度为零。

## Cow\<T\>：写时克隆

`Cow`（Clone on Write）是一个枚举，有两种状态：`Borrowed`（持有借用）和 `Owned`（持有所有权）。核心策略是**能借用就借用，需要修改时才克隆**，类似操作系统的 Copy-on-Write 内存页机制。

```rust
pub enum Cow<'a, B> where B: ToOwned + ?Sized {
    Borrowed(&'a B),      // 只存一个指针，指向别人的数据
    Owned(<B as ToOwned>::Owned),  // 拥有数据的所有权
}
```

```rust
use std::borrow::Cow;

fn maybe_uppercase(s: &str) -> Cow<str> {
    if s.chars().any(|c| c.is_lowercase()) {
        Cow::Owned(s.to_uppercase())    // 需要修改 → 新建 String
    } else {
        Cow::Borrowed(s)                // 不修改 → 零分配
    }
}

let a = maybe_uppercase("HELLO"); // Borrowed，零开销
let b = maybe_uppercase("hello"); // Owned，分配了新 String
```

如果返回值类型只能选 `&str` 或 `String`：选 `&str` 就没法返回修改后的数据，选 `String` 则即使不需要修改也要在堆上分配内存。`Cow` 统一了这两种情况。

### 传 &T 还是 T：初始状态不同

传入 `&T` 和 `T` 决定了 `Cow` 初始化为哪个枚举分支，内存布局和生命周期约束完全不同：

| | 传入 `&T`（Borrowed） | 传入 `T`（Owned） |
| --- | --- | --- |
| 内存布局 | 只存一个指针，数据留在原处 | 数据所有权移入 `Cow` 内部 |
| 生命周期 | 受限于原始数据的 `'a` | 独立，不依赖外部数据 |
| 分配开销 | 零（只是一个地址） | 取决于 `T` 的来源（Move 进来则无额外开销） |

```rust
// &T → Borrowed 状态
let a: Cow<str> = Cow::from("hello");               // Cow::Borrowed

// T → Owned 状态
let b: Cow<str> = Cow::from(String::from("hello"));  // Cow::Owned
```

### .to_mut()：按需触发克隆

`.to_mut()` 保证返回 `&mut T`，但根据当前状态开销不同：

```rust
let mut a: Cow<str> = Cow::Borrowed("hello");
a.to_mut().push_str(" world");  // 触发克隆：堆分配 + 复制数据，Borrowed → Owned

let mut b: Cow<str> = Cow::Owned(String::from("hello"));
b.to_mut().push_str(" world");  // 已经是 Owned，直接修改，零额外开销
```

| 当前状态 | `.to_mut()` 的行为 | 开销 |
| --- | --- | --- |
| `Borrowed` | 调用 `to_owned()` 克隆数据到堆上，状态切换为 `Owned` | 堆分配 + 数据复制 |
| `Owned` | 直接返回内部数据的 `&mut` | 零 |

这正是"写时克隆"的含义：读的时候零开销持有引用，写的时候才付出克隆的代价。对于"大部分只读、偶尔修改"的场景（如日志处理、配置解析），`Cow` 可以让绝大多数操作保持 `Borrowed`，只在少数需要修改时触发分配。

对所有 `Cow` 支持的类型都成立：`str`/`String`、`[T]`/`Vec<T>`、`Path`/`PathBuf` 等。

### Cow vs Arc/Rc 传 &T 的区别

`Cow` 设计上就是"可能借用可能拥有"，区分两种状态有意义。而 `Arc::new()` / `Rc::new()` 只接受 `T`（必须拥有所有权），传 `&T` 会得到 `Arc<&T>` 这种无意义的类型。

## 常见组合模式

| 需求 | 组合 |
| --- | --- |
| 堆分配，单一所有者 | `Box<T>` |
| 单线程共享只读 | `Rc<T>` |
| 单线程共享 + 可变 | `Rc<RefCell<T>>` |
| 多线程共享只读 | `Arc<T>` |
| 多线程共享 + 可变 | `Arc<Mutex<T>>` |
| 多线程共享 + 多读少写 | `Arc<RwLock<T>>` |
| 防止循环引用 | `Weak<T>`（`Rc` 或 `Arc` 的弱引用） |
| 避免不必要的克隆 | `Cow<T>` |

## 两条主线

```text
单线程：Box → Rc + Weak → Cell / RefCell → Cow
多线程：Arc + Weak → Mutex / RwLock
```

本质上是在编译期严格规则和运行时灵活性之间做权衡：

- `Box`：编译期所有权，零额外开销
- `Rc`/`Arc`：运行时引用计数，换取共享所有权
- `RefCell`：运行时借用检查，换取内部可变性
- `Mutex`/`RwLock`：运行时锁，换取多线程可变访问
- `Cow`：延迟克隆，在不修改时零开销
