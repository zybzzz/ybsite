# Rust 解引用、DST 与 Deref 机制

## 1. 从一个例子开始：`&mut &'static str`

```rust
fn change_announcement(current: &mut &'static str) {
    *current = "Breaking News: Rust is awesome!";
}

fn main() {
    let mut s: &'static str = "Standard Greeting";
    change_announcement(&mut s);
    println!("{}", s); // 输出: Breaking News: Rust is awesome!
}
```

关键点：

- `s` 的类型是 `&'static str`，它是一个存放"字符串切片引用"的变量
- `change_announcement(&mut s)` 传入的是**对变量 `s` 的可变借用**
- `*current = ...` 修改的是 `s` 保存的引用值，**不是**修改字符串字面量本身的内容

## 2. `mut` 参数 vs `&mut` 参数

### `mut current: &'static str` — 按值传递的局部副本

```rust
fn change_announcement(mut current: &'static str) {
    current = "Breaking News: Rust is awesome!"; // 只改了局部副本
}

fn main() {
    let mut s: &'static str = "Standard Greeting";
    change_announcement(s);
    println!("{}", s); // 仍然输出: Standard Greeting
}
```

`mut` 只是让函数内部的局部变量 `current` 可重新赋值，它是从调用者那里**按值拷贝**过来的副本，不影响外部。

### `current: &mut &'static str` — 可变借用外部变量

```rust
fn change_announcement(current: &mut &'static str) {
    *current = "Breaking News: Rust is awesome!"; // 修改了外部变量
}
```

`current` 是一个可变借用，借用的是外部那个 `&'static str` 类型的变量。`*current = ...` 等价于直接修改调用者手里的变量。

### 指向关系

```text
初始状态:
  s: &'static str  ──→  "Standard Greeting"

调用时:
  current: &mut (&'static str)  ──→  s  ──→  "Standard Greeting"

执行 *current = ... 后:
  s: &'static str  ──→  "Breaking News: Rust is awesome!"
```

## 3. `mut T`、`&mut T`、`&mut &T`、`&mut &mut T` 辨析

| 写法 | 含义 | 能改什么 |
| ------ | ------ | ---------- |
| `let mut x: T` | 变量绑定可变 | 可以重新给 `x` 赋值 |
| `x: &mut T` | 对 `T` 的可变借用 | 可通过 `*x` 修改底层对象 |
| `x: &mut &T` | 对"引用变量"的可变借用 | 可通过 `*x` 改引用指向，但不能改底层 `T` |
| `x: &mut &mut T` | 对"可变引用变量"的可变借用 | 可通过 `**x` 一路改到底层对象 |

示例：

```rust
// &mut T
fn add_one(x: &mut i32) { *x += 1; }

// &mut &T
fn change_ref(r: &mut &str) { *r = "world"; } // 改引用指向

// &mut &mut T
fn deep_mut(rr: &mut &mut i32) { **rr += 1; } // 改底层值
```

## 4. 字符串字面量与 `&'static str`

字符串字面量 `"hello"` 的类型是 `&'static str`，这是**语言内建规则**：

- 字符串数据存放在程序的**静态只读区域**
- 表达式 `"hello"` 产生一个指向该静态数据的字符串切片引用
- 生命周期为 `'static`，因为数据在程序整个运行期都有效

**不能**写 `let s: str = "hello"`，因为 `str` 是 DST（见下节）。

## 5. DST（动态大小类型）

`str`、`[T]`、`dyn Trait` 都是 DST（unsized type），编译期无法确定其大小。

### DST 的限制

- **不能**直接作为局部变量：`let x: str = ...;` ✗
- **不能**按值作为函数参数：`fn foo(x: str) {}` ✗
- **不能**按值作为返回值：`fn make() -> str {}` ✗

### DST 的使用方式 — 放在指针后面

通过固定大小的指针间接使用：`&str`、`&[T]`、`&dyn Trait`、`Box<str>`、`Rc<str>`、`Arc<dyn Trait>` 等。

这些指针通常是**胖指针**：

| 类型 | 胖指针包含 |
| ------ | ----------- |
| `&str` / `&[T]` | 数据指针 + 长度 |
| `&dyn Trait` | 数据指针 + vtable 指针 |

### 结构体中的 DST

DST 只能作为结构体的**最后一个字段**（否则后续字段的偏移量无法静态确定），且通常通过 `Box<MyStr>` 等方式使用。

### 泛型与 `?Sized`

泛型参数默认有 `Sized` 约束。若需接受 DST，须显式声明 `?Sized`：

```rust
fn foo<T: ?Sized>(x: &T) {} // 可接受 DST，但必须通过引用
```

## 6. `&str`、`str`、`String`、`Box<str>` 对比

| 类型 | 本质 | 大小 | 所有权 |
| ------ | ------ | ------ | -------- |
| `str` | UTF-8 字节序列（DST） | 不固定 | 无（裸类型） |
| `&str` | 指向 `str` 的胖指针 `(ptr, len)` | 固定 | 借用 |
| `String` | 可增长的堆字符串 `(ptr, len, cap)` | 固定 | 拥有 |
| `Box<str>` | 堆上拥有的 `str` | 固定 | 拥有 |

## 7. `*current = ...` 的解析机制

```rust
fn change_announcement(current: &mut &'static str) {
    *current = "Breaking News: Rust is awesome!";
}
```

### 类型推导过程

1. `current: &mut (&'static str)` — 可变引用，借用一个 `&'static str` 的槽位
2. `*current` — 解掉外层 `&mut`，得到类型为 `&'static str` 的**可写位置**（place expression）
3. 右边 `"Breaking News..."` 的类型也是 `&'static str`
4. 左右类型匹配，执行赋值：把新值写入该槽位

**关键区分**：`*current` 在赋值左边时是 **place expression**（可写位置），不是先求值成临时量再赋值。Rust 中赋值左边可以是变量、字段、下标、解引用结果，只要表示一个"位置"即可。

**只解了一层**：`*current` 得到的是 `&'static str`，不是 `str`。修改的是引用值，不是字符串内容。若写 `**current` 则会得到 `str`（DST），这不是这里要的语义。

## 8. 解引用的三种机制

### 8.1 内建解引用（原生引用上的 `*`）

对 `&T` / `&mut T` 上的 `*` 运算，Rust 直接用语言内建规则处理，**不依赖** `Deref` / `DerefMut`。

```rust
let x = 5;
let p = &x;
let y = *p;     // 内建解引用

let mut n = 10;
let q = &mut n;
*q = 20;        // 内建解引用

// 前面例子中的 *current = ... 也是内建解引用
```

### 8.2 `Deref` / `DerefMut` trait

让非原生引用类型（智能指针等）也能像引用一样工作：

```rust
trait Deref {
    type Target: ?Sized;
    fn deref(&self) -> &Self::Target;
}

trait DerefMut: Deref {
    fn deref_mut(&mut self) -> &mut Self::Target;
}
```

典型实现：`String: Deref<Target = str>`、`Box<T>: Deref<Target = T>`。

自定义示例：

```rust
use std::ops::Deref;

struct MyBox<T>(T);

impl<T> Deref for MyBox<T> {
    type Target = T;
    fn deref(&self) -> &T { &self.0 }
}

let x = MyBox(5);
println!("{}", *x); // 通过 Deref trait 解引用
```

### 8.3 自动解引用（编译器隐式行为）

编译器在特定上下文自动帮你解引用，过程中可能借助 `Deref`：

**方法调用**：编译器逐层尝试自动借用、自动解引用来查找方法。

```rust
let s = String::from("abc");
s.len(); // len() 定义在 str 上，编译器通过 Deref<Target = str> 找到
```

**Deref coercion**（参数类型匹配时的自动转换）：

```rust
fn takes_str(s: &str) {}
let s = String::from("abc");
takes_str(&s); // &String 自动转为 &str，依赖 Deref
```

**Unsize coercion**（与 Deref 无关的另一种转换）：

```rust
let a: &[i32] = &[1, 2, 3];   // &[i32; 3] → &[i32]，unsize coercion
let x: &dyn Display = &5;      // &i32 → &dyn Display，unsize coercion
```

## 9. 快速判断：用的是哪种机制？

| 场景 | 机制 |
| ------ | ------ |
| `*x`，`x` 是 `&T` / `&mut T` | 语言内建解引用 |
| `*x`，`x` 是 `Box<T>` / 自定义智能指针 | `Deref` / `DerefMut` |
| `x.method()`，方法定义在更深层类型上 | 自动解引用 + 可能借助 `Deref` |
| `&String` → `&str` | Deref coercion |
| `&[T; N]` → `&[T]` | Unsize coercion |
| `&Concrete` → `&dyn Trait` | Unsize coercion |

## 10. 速记总结

**类型与可变性**：

- `let mut x: T` — 变量绑定可变
- `x: &mut T` — 可变借用一个 `T`
- `x: &mut &T` — 可变借用一个"引用变量"
- `x: &mut &mut T` — 可变借用一个"可变引用变量"

**字符串**：

- `"hello"` 的类型是 `&'static str`（语言内建）
- `str` 是 DST，不能直接当局部变量
- `&str` 是胖指针，可以当局部变量
- `String` 是拥有所有权的堆字符串

**解引用**：

- `*` 在原生引用上 → 语言内建
- 方法调用中的自动查找 → 自动解引用（可能借助 `Deref`）
- `&String` → `&str` → Deref coercion
- `&[T; N]` → `&[T]` → Unsize coercion
- `&Concrete` → `&dyn Trait` → Unsize coercion
