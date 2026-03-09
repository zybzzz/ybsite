# 模式匹配与 Copy/Move 规则

## 模式匹配基础

`match` 中的每个分支是一个**模式（pattern）**，用于解构值并绑定变量。模式匹配不是赋值，而是"从值里把东西拿出来"。

```rust
match some_value {
    模式 => 表达式,
    _ => 兜底,
}
```

## 常见模式类型

### 字面量匹配

```rust
match x {
    1 => println!("one"),
    2 | 3 => println!("two or three"),  // | 表示或
    4..=9 => println!("four to nine"),  // ..= 范围
    _ => println!("other"),
}
```

### 解构结构体

```rust
struct Point { x: i32, y: i32 }

match p {
    Point { x, y } => println!("{x}, {y}"),        // 绑定所有字段
    Point { x, .. } => println!("{x}"),             // .. 忽略其余字段
    Point { x: 0, y } => println!("on y-axis: {y}"), // 字面量 + 绑定混用
}
```

### 解构枚举

```rust
match opt {
    Some(val) => println!("{val}"),
    None => println!("nothing"),
}
```

### 解构嵌套

```rust
match optional_point {
    Some(Point { x, y }) => println!("{x}, {y}"),  // 同时解构 Option 和 Point
    None => {},
}
```

## 模式匹配中的 Copy 与 Move

这是最容易混淆的地方。核心规则：

> **模式绑定出来的变量类型决定了是 copy 还是 move。**

### 规则一：绑定 Copy 类型 → 拷贝

如果绑定出来的变量类型实现了 `Copy`（如 `i32`、`bool`、`f64`），则发生拷贝，原值不受影响。

```rust
let optional_point = Some(Point { x: 100, y: 200 });

match optional_point {
    Some(Point { x, y }) => println!("{x}, {y}"),
    //         ↑  ↑
    //     x: i32, y: i32 都是 Copy，拷贝出来
    _ => {}
}
println!("{optional_point:?}"); // OK，optional_point 没有被 move
```

### 规则二：绑定非 Copy 类型 → move

如果绑定出来的变量类型没有实现 `Copy`，则发生 move，原值不可再用。

```rust
let optional_point = Some(Point { x: 100, y: 200 });

match optional_point {
    Some(p) => println!("{},{}", p.x, p.y),
    //   ↑
    //   p: Point（未实现 Copy）→ move
    None => {}
}
// println!("{optional_point:?}"); // 编译错误：value moved
```

### 对比总结

同一个 `optional_point`，两种写法的区别：

| 模式 | 绑定的变量 | 类型 | Copy? | 结果 |
| --- | --- | --- | --- | --- |
| `Some(Point { x, y })` | `x`, `y` | `i32` | 是 | 拷贝，原值可用 |
| `Some(p)` | `p` | `Point` | 否 | move，原值不可用 |

## 避免 move 的方式：ref 与引用匹配

### 方式一：ref 关键字

在模式中用 `ref` 修饰，绑定的是引用而非值：

```rust
match optional_point {
    Some(ref p) => println!("{},{}", p.x, p.y),
    //   ↑ p: &Point，借用而非 move
    None => {}
}
println!("{optional_point:?}"); // OK
```

`ref mut` 则绑定可变引用：

```rust
match optional_point {
    Some(ref mut p) => p.x = 999,
    //   ↑ p: &mut Point
    None => {}
}
```

### 方式二：match 引用

对引用做匹配，模式自动按引用绑定：

```rust
match &optional_point {
//    ↑ 匹配的是 &Option<Point>
    Some(p) => println!("{},{}", p.x, p.y),
    //   ↑ p: &Point（自动推导为引用）
    None => {}
}
println!("{optional_point:?}"); // OK
```

## 完整规则速查

```
模式绑定变量时：
  1. 变量类型实现 Copy  → 拷贝，原值不受影响
  2. 变量类型未实现 Copy → move，原值不可再用
  3. 用 ref 修饰          → 绑定为 &T，借用
  4. 用 ref mut 修饰      → 绑定为 &mut T，可变借用
  5. match &value         → 模式中变量自动绑定为引用
```

## if let 与 while let

`match` 只有一个分支关心时的简写：

```rust
// if let
if let Some(Point { x, y }) = optional_point {
    println!("{x}, {y}");
}

// while let
while let Some(val) = stack.pop() {
    println!("{val}");
}
```

规则与 `match` 完全一致，同样遵循 Copy/Move 规则。
