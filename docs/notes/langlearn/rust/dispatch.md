# 静态分发与动态分发

## 问题根源：Trait 不能直接作为参数类型

Rust 中每个变量在编译时必须有确定的内存大小。Trait 是 Unsized 类型——不同结构体实现同一个 Trait 时占用的内存可能完全不同，编译器不知道在栈上预留多少空间，因此不能直接写 `fn foo(x: SomeTrait)`。

解决办法有两种：让编译器在编译期确定类型（静态分发），或者通过指针间接调用（动态分发）。

## 静态分发：impl Trait / 泛型

### 写法

```rust
// impl Trait 语法（简洁）
fn compare(a: impl Licensed, b: impl Licensed) -> bool {
    a.licensing_info() == b.licensing_info()
}

// 等价的泛型写法（更灵活）
fn compare<T: Licensed, U: Licensed>(a: T, b: U) -> bool {
    a.licensing_info() == b.licensing_info()
}
```

### 原理：单态化（Monomorphization）

编译器在编译期为每种具体类型组合生成一份专门的函数副本：

```text
compare(SomeSoftware, SomeSoftware)   → 生成函数副本 1
compare(SomeSoftware, OtherSoftware)  → 生成函数副本 2
compare(OtherSoftware, OtherSoftware) → 生成函数副本 3
```

每个副本中方法调用是**直接调用**（call 指令直接跳转到目标地址），没有任何间接跳转。

### 特点

- 零运行时开销，编译器可以内联优化
- 类型组合多时会导致二进制膨胀（代码段变大）
- 调用者必须在编译期知道具体类型

## 动态分发：dyn Trait

### dyn 写法

```rust
fn compare(a: &dyn Licensed, b: &dyn Licensed) -> bool {
    a.licensing_info() == b.licensing_info()
}
```

`dyn Licensed` 必须放在引用（`&dyn`）或智能指针（`Box<dyn>`）后面，因为 `dyn Trait` 本身大小不确定。

### 原理：胖指针 + vtable

`&dyn Licensed` 是一个**胖指针**，包含两个指针宽度的数据：

```text
&dyn Licensed
├── *data   → 指向实际数据（SomeSoftware 或 OtherSoftware 的实例）
└── *vtable → 指向该类型的虚函数表
```

vtable 中存放了该类型对 Trait 中每个方法的具体实现地址：

```text
vtable for SomeSoftware as Licensed:
  licensing_info → 0x1234 (SomeSoftware::licensing_info 的地址)

vtable for OtherSoftware as Licensed:
  licensing_info → 0x5678 (OtherSoftware::licensing_info 的地址)
```

方法调用时通过 vtable 间接跳转，类似 C++ 的虚函数调用。

### dyn 特点

- 函数体只有一份，不会膨胀
- 每次方法调用多一次指针解引用，且无法内联
- 可以在运行时决定具体类型（如存入同一个集合）

## 关键区别对比

|   | 静态分发 `impl Trait` / 泛型 | 动态分发 `&dyn Trait` |
| --- | --- | --- |
| 类型确定时机 | 编译期 | 运行期 |
| 方法调用方式 | 直接调用 | 通过 vtable 间接调用 |
| 能否内联 | 能 | 不能 |
| 运行时开销 | 无 | 指针解引用 |
| 二进制大小 | 类型多时膨胀 | 函数体只一份 |
| 能否放入同一集合 | 不能（类型不同） | 能（`Vec<Box<dyn T>>`） |

## 典型使用场景

### 用静态分发

性能敏感路径、类型在编译期已知、类型组合不多时：

```rust
fn process(item: impl Processor) {
    item.run(); // 编译器直接内联
}
```

### 用动态分发

需要在同一个容器中存放不同类型时：

```rust
// 不同类型的插件放进同一个 Vec
let plugins: Vec<Box<dyn Plugin>> = vec![
    Box::new(AudioPlugin),
    Box::new(VideoPlugin),
    Box::new(NetworkPlugin),
];

for p in &plugins {
    p.execute(); // 运行时通过 vtable 分发
}
```

这是静态分发做不到的——`Vec` 要求所有元素类型相同，而 `Box<dyn Plugin>` 统一了类型（都是胖指针）。

## impl Trait 与泛型的区别

两者都是静态分发，但有细微差异：

```rust
// impl Trait：每个参数可以是不同的具体类型
fn foo(a: impl Licensed, b: impl Licensed) { ... }
// a 和 b 可以是不同类型

// 泛型约束：可以要求参数是同一类型
fn bar<T: Licensed>(a: T, b: T) { ... }
// a 和 b 必须是同一类型
```

泛型还支持更复杂的约束（多 trait bound、where 子句等），`impl Trait` 是泛型的语法糖简写。
