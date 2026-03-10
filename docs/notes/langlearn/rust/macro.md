# Rust 宏

## 宏的本质

宏是在编译期展开的代码生成工具。函数操作的是值，宏操作的是**代码本身**（token 流）。宏在编译器做类型检查之前展开，所以能做到函数做不到的事：生成重复代码、创建新语法、根据参数数量变化行为。

Rust 中的宏分两大类：**声明宏**（Declarative Macros）和**过程宏**（Procedural Macros）。

## 声明宏 macro_rules

最常用的宏类型，通过模式匹配生成代码。标准库中的 `vec!`、`println!`、`format!` 都是声明宏。

### 基本语法

```rust
macro_rules! 宏名 {
    (模式) => { 展开的代码 };
    (模式) => { 展开的代码 };  // 可以有多个分支
}
```

### 最简单的例子

```rust
macro_rules! say_hello {
    () => {
        println!("Hello!");
    };
}

say_hello!(); // 展开为 println!("Hello!");
```

### 捕获参数

宏通过 `$name:类型` 的语法捕获输入的 token：

```rust
macro_rules! create_function {
    ($func_name:ident) => {
        fn $func_name() {
            println!("Called {:?}", stringify!($func_name));
        }
    };
}

create_function!(foo);  // 生成 fn foo() { ... }
foo();                  // "Called \"foo\""
```

### 捕获类型一览

| 标识符 | 匹配内容 | 示例 |
| --- | --- | --- |
| `$x:expr` | 表达式 | `1 + 2`、`foo()` |
| `$x:ident` | 标识符（变量名、函数名） | `my_var`、`String` |
| `$x:ty` | 类型 | `i32`、`Vec<String>` |
| `$x:pat` | 模式 | `Some(x)`、`_` |
| `$x:stmt` | 语句 | `let x = 1` |
| `$x:block` | 代码块 | `{ ... }` |
| `$x:item` | 条目（函数、结构体定义等） | `fn foo() {}` |
| `$x:path` | 路径 | `std::collections::HashMap` |
| `$x:tt` | 单个 token tree | 任意 token（万能匹配） |
| `$x:literal` | 字面量 | `42`、`"hello"` |
| `$x:meta` | 属性内容 | `derive(Debug)` |

### 重复匹配

用 `$(...)*` 或 `$(...)+` 处理可变数量的参数（`*` 零次或多次，`+` 一次或多次）：

```rust
macro_rules! my_vec {
    // 匹配逗号分隔的表达式列表
    ( $( $x:expr ),* ) => {
        {
            let mut v = Vec::new();
            $( v.push($x); )*   // 对每个 $x 重复执行
            v
        }
    };
}

let v = my_vec![1, 2, 3]; // 展开为 push(1); push(2); push(3);
```

### 多分支匹配

宏可以像 `match` 一样有多个分支，按顺序尝试匹配：

```rust
macro_rules! calculate {
    (eval $e:expr) => {
        println!("{} = {}", stringify!($e), $e);
    };
    (sum $($x:expr),+) => {
        {
            let mut total = 0;
            $( total += $x; )+
            total
        }
    };
}

calculate!(eval 1 + 2);           // "1 + 2 = 3"
let s = calculate!(sum 1, 2, 3);  // 6
```

### 递归宏

宏可以调用自身实现递归展开：

```rust
macro_rules! count {
    () => { 0usize };
    ($head:tt $($tail:tt)*) => { 1usize + count!($($tail)*) };
}

let n = count!(a b c d); // 4
```

## 过程宏：操作 TokenStream

过程宏是用 Rust 代码编写的编译器插件，接收 `TokenStream` 并输出 `TokenStream`。必须定义在独立的 crate 中（`Cargo.toml` 中 `proc-macro = true`）。

过程宏有三种类型。

### derive 宏

最常见的过程宏，通过 `#[derive(...)]` 自动为类型生成 trait 实现：

```rust
// 使用标准库自带的 derive
#[derive(Debug, Clone, PartialEq)]
struct Point {
    x: f64,
    y: f64,
}
// 编译器自动生成 Debug、Clone、PartialEq 的 impl
```

自定义 derive 宏（需要在独立 crate 中）：

```rust
// my_macro/src/lib.rs
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput};

#[proc_macro_derive(HelloMacro)]
pub fn hello_macro_derive(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let name = &ast.ident;

    let expanded = quote! {
        impl HelloMacro for #name {
            fn hello() {
                println!("Hello from {}!", stringify!(#name));
            }
        }
    };

    TokenStream::from(expanded)
}
```

```rust
// 使用方
use hello_macro::HelloMacro;
use hello_macro_derive::HelloMacro;

#[derive(HelloMacro)]
struct Pancakes;

Pancakes::hello(); // "Hello from Pancakes!"
```

### 属性宏

附加在函数、结构体等条目上，可以修改或替换被标注的代码：

```rust
// 定义（在 proc-macro crate 中）
#[proc_macro_attribute]
pub fn route(attr: TokenStream, item: TokenStream) -> TokenStream {
    // attr: 属性参数（如 GET, "/"）
    // item: 被标注的函数
    // 返回修改后的代码
}

// 使用
#[route(GET, "/")]
fn index() -> &'static str {
    "Hello"
}
```

Web 框架（如 actix-web、axum）大量使用属性宏定义路由。

### 函数式过程宏

像函数调用一样使用，但在编译期展开：

```rust
// 定义
#[proc_macro]
pub fn sql(input: TokenStream) -> TokenStream {
    // 解析 SQL 语句，生成类型安全的查询代码
}

// 使用
let query = sql!(SELECT * FROM users WHERE id = 1);
```

## 常用标准 derive 宏

| derive | 生成的 trait | 用途 |
| --- | --- | --- |
| `Debug` | `fmt::Debug` | `{:?}` 格式化输出 |
| `Clone` | `Clone` | `.clone()` 深拷贝 |
| `Copy` | `Copy` | 值语义拷贝（要求同时 derive Clone） |
| `PartialEq` | `PartialEq` | `==` 比较 |
| `Eq` | `Eq` | 完全等价关系（要求同时 derive PartialEq） |
| `PartialOrd` | `PartialOrd` | `<` `>` 比较 |
| `Ord` | `Ord` | 完全排序 |
| `Hash` | `Hash` | 可用作 HashMap 的 key |
| `Default` | `Default` | `Default::default()` 默认值 |

## 宏的可见性与导出

### 声明宏的可见性

声明宏的可见性规则和普通函数不同，有自己的一套体系。

**模块内可见（默认）**：

宏默认只在定义它的模块及其子模块中可见：

```rust
mod utils {
    macro_rules! helper {
        () => { 42 };
    }

    pub fn foo() -> i32 {
        helper!() // OK：同模块内可用
    }
}

// helper!(); // 错误：在 utils 外不可见
```

**`#[macro_export]`：导出到 crate 根**：

加上 `#[macro_export]` 后，宏被提升到 crate 根，外部 crate 可以使用：

```rust
// my_crate/src/utils.rs
#[macro_export]
macro_rules! my_macro {
    () => { println!("hello") };
}
// 注意：虽然定义在 utils 模块里，但 #[macro_export] 把它提升到了 crate 根
// 外部使用时是 my_crate::my_macro!()，而非 my_crate::utils::my_macro!()
```

**`#[macro_use]`：批量导入**：

```rust
// 导入外部 crate 的所有导出宏（旧写法，2015 edition）
#[macro_use]
extern crate my_crate;

// 现在推荐直接用 use 导入（2018+ edition）
use my_crate::my_macro;
```

在模块上使用 `#[macro_use]` 可以把子模块的宏提升到父模块：

```rust
#[macro_use]
mod utils {
    macro_rules! helper {
        () => { 42 };
    }
}

let x = helper!(); // OK：#[macro_use] 把宏提升到了当前模块
```

### 声明宏的定义顺序

声明宏必须在使用之前定义（从上到下）。这和函数不同——函数可以先使用后定义，宏不行：

```rust
// my_macro!(); // 错误：此时还没定义

macro_rules! my_macro {
    () => {};
}

my_macro!(); // OK
```

跨模块时，`mod` 声明的顺序也有影响。使用宏的模块必须在定义宏的模块之后声明：

```rust
// lib.rs
#[macro_use]
mod macros;   // 先声明定义宏的模块

mod logic;    // 后声明使用宏的模块（logic 中可以用 macros 里的宏）
```

### 过程宏的可见性

过程宏必须定义在独立的 crate 中，可见性遵循普通的 `pub` 规则。使用时作为依赖引入：

```toml
# Cargo.toml
[dependencies]
my_macro_derive = { path = "../my_macro_derive" }
```

```rust
use my_macro_derive::HelloMacro;

#[derive(HelloMacro)]
struct Foo;
```

## 宏调用语法

声明宏支持三种括号，语义完全相同，只是惯例不同：

```rust
my_macro!()    // 函数风格，最通用
my_macro![]    // 类似数组，vec![] 用这个
my_macro!{}    // 类似代码块，用于生成条目（struct、impl 等）
```

## 声明宏 vs 过程宏

| | 声明宏 `macro_rules!` | 过程宏 |
| --- | --- | --- |
| 定义方式 | 模式匹配 | Rust 函数处理 TokenStream |
| 定义位置 | 任意 crate | 必须独立 crate |
| 能力 | 模式替换、重复展开 | 任意代码生成、解析 AST |
| 复杂度 | 简单到中等 | 中等到复杂 |
| 依赖 | 无 | 通常需要 `syn` + `quote` |
| 典型用途 | `vec!`、`println!`、简单代码生成 | `#[derive]`、属性标注、DSL |

## 实用技巧

### stringify 和 concat

编译器内置宏，用于在编译期操作字符串：

```rust
let s = stringify!(1 + 2);   // "1 + 2"（token 转字符串，不求值）
let s = concat!("hello", " ", "world"); // "hello world"（编译期拼接）
```

### cfg! 条件编译

```rust
if cfg!(target_os = "linux") {
    println!("Linux");
}

// 属性形式，整个条目有条件编译
#[cfg(test)]
mod tests { ... }
```

### include! 系列

```rust
include!("generated.rs");           // 编译期包含文件内容作为代码
include_str!("config.toml");        // 编译期包含文件内容为 &str
include_bytes!("image.png");        // 编译期包含文件内容为 &[u8]
```

### todo / unimplemented / unreachable

```rust
fn wip() -> i32 {
    todo!()           // 标记待实现，panic 时提示 "not yet implemented"
}

fn legacy() {
    unimplemented!()  // 明确表示不打算实现
}

fn checked(x: i32) {
    match x {
        1 => {},
        2 => {},
        _ => unreachable!(), // 断言此分支不可达
    }
}
```
