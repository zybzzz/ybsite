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

### Rc 的限制

- **仅单线程**，不能跨线程传递
- **默认不可变**，多个 `Rc` 共享意味着多个"所有者"，允许可变会破坏安全性
- 需要可变性时配合 `RefCell` 使用

### Weak\<T\>：防止循环引用

`Rc` 有循环引用导致内存泄漏的风险。`Weak` 是不增加引用计数的弱引用：

```rust
use std::rc::{Rc, Weak};

let strong = Rc::new(42);
let weak: Weak<i32> = Rc::downgrade(&strong);

// 使用时需要 upgrade，返回 Option<Rc<T>>
if let Some(val) = weak.upgrade() {
    println!("{val}");
}

drop(strong);
assert!(weak.upgrade().is_none()); // 原数据已释放
```

典型场景：树结构中子节点指向父节点用 `Weak`，避免父子互相引用导致计数永远不归零。

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

适用于读多写少的场景，比编译期检查要用 `Mutex`。

## Cow\<T\>：写时克隆

`Cow`（Clone on Write）有两种状态：`Borrowed`（持有借用）和 `Owned`（持有所有权）。能借用就借用，需要修改时才克隆。

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

### 传 &T 还是 T：初始状态不同

```rust
// &T → Borrowed 状态
let a: Cow<str> = Cow::from("hello");               // Cow::Borrowed

// T → Owned 状态
let b: Cow<str> = Cow::from(String::from("hello"));  // Cow::Owned
```

后续调用 `.to_mut()` 时行为不同：

```rust
let mut a: Cow<str> = Cow::Borrowed("hello");
a.to_mut().push_str(" world");  // 触发克隆，Borrowed → Owned

let mut b: Cow<str> = Cow::Owned(String::from("hello"));
b.to_mut().push_str(" world");  // 已经是 Owned，直接修改，无额外开销
```

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
