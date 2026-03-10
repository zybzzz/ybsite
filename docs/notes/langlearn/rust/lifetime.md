# Rust 生命周期

## 为什么需要生命周期标注

Rust 的借用检查器需要在编译期确定每个引用的有效范围，确保不会出现悬垂引用。大多数情况下编译器能自动推导（Elision Rules），但当函数签名中有多个引用输入且返回引用时，编译器无法判断返回值的寿命该跟谁绑定，此时需要开发者手动标注。

## 三条核心规则

### 相同名称取短的

当多个引用共享同一个生命周期参数 `'a` 时，`'a` 的实际有效期是所有参与者中最短的那个。

```rust
struct Pair<'a> {
    x: &'a i64,
    y: &'a i64,
}

fn main() {
    let long_lived = 42;                    // 寿命长
    {
        let short_lived = 99;              // 寿命短
        let pair = Pair { x: &long_lived, y: &short_lived };
        // pair 的 'a 被收缩到 short_lived 的范围
    }
    // pair 在这里已经不可用，即使 long_lived 还活着
}
```

编译器的逻辑：`'a ⊆ (Lifetime(x) ∩ Lifetime(y))`，取交集，以短板为准。

如果不希望两个字段互相拖累，就用不同的生命周期参数：

```rust
struct Pair<'a, 'b> {
    x: &'a i64,
    y: &'b i64,
}
```

此时 `x` 和 `y` 的有效期彼此独立，一个失效不影响另一个。

### 不同名称不相关

`'a` 和 `'b` 是两个独立的约束维度，默认没有任何关联。可以通过 `'a: 'b` 手动建立依赖关系，含义是 `'a` 至少活得和 `'b` 一样久：

```rust
// 'long 必须比 'short 活得久
struct Nested<'long, 'short: 'long> {
    context: &'long Config,
    task: &'short Task,
}
```

### 函数签名决定流转

函数签名是一份生命周期的路由协议。编译器不看函数体内部的具体逻辑，只根据签名来判断返回值的寿命从哪个输入端继承。

```rust
// 返回值的寿命跟 x 绑定，与 y 无关
fn select_first<'a, 'b>(x: &'a str, y: &'b str) -> &'a str {
    x
}
```

即使 `y` 在调用后立刻销毁，返回值依然有效，因为签名声明了它只依赖 `x`。

反过来，如果签名是 `fn f<'a>(x: &'a str, y: &'a str) -> &'a str`，返回值的寿命就会被拽到 `x` 和 `y` 中更短的那个。

## 结构体中的生命周期

结构体定义中的 `'a` 是形参（占位符），实例化时被具体的引用寿命替换：

```rust
struct Buffer<'a> {
    data: &'a [u8],
}

impl<'a> Buffer<'a> {
    // 返回值寿命来自结构体持有的 'a
    fn get_data(&self) -> &'a [u8] {
        self.data
    }
}
```

结构体的实际寿命由初始化时传入的引用决定。如果传入的引用经过函数流转被收缩了，结构体实例的寿命也随之收缩——结构体的寿命由它持有数据的**当前实际有效寿命**决定，而非数据的"出生寿命"。

## 生命周期的收缩：只缩不扩

生命周期的变换遵循一个原则：长寿命的引用可以当短的用（协变），反过来不行。

```rust
fn transform<'short, 'long: 'short>(input: &'long i64) -> &'short i64 {
    input  // 'long 被收缩为 'short
}
```

一旦收缩发生，后续所有依赖这个返回值的代码都只能按收缩后的寿命来使用。

## 复杂项目中的写法

### 语义化命名

简单示例用 `'a`、`'b`，工程项目中推荐用有含义的名称提升可读性：

```rust
struct Parser<'src, 'ctx> {
    source: &'src str,     // 源码的寿命
    config: &'ctx Config,  // 配置上下文的寿命
}
```

### 'static

`'static` 表示引用在程序的整个运行期间都有效。字符串字面量就是 `'static`：

```rust
let s: &'static str = "hello";  // 存储在二进制只读数据段
```

### 高阶 Trait 约束（HRTB）

`for<'a>` 表示"对于任何可能的生命周期 `'a`，约束都成立"，常见于闭包和回调场景：

```rust
fn execute<F>(f: F)
where
    F: for<'a> Fn(&'a str) -> &'a str
{
    let s = String::from("hello");
    f(&s);
}
```

## 速查

| 标注 | 含义 |
| --- | --- |
| `'a` | 生命周期参数，编译期占位符 |
| `'a: 'b` | `'a` 至少活得和 `'b` 一样久 |
| `'static` | 整个程序运行期间有效 |
| `for<'a>` | 对任意生命周期 `'a` 都成立 |
| 同一个 `'a` 标注多个引用 | 取最短者 |
| 不同参数 `'a` `'b` | 互相独立 |
| 函数签名中的 `'a` | 声明返回值的寿命来源 |
