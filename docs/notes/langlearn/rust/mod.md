# Rust 模块系统与 use

## mod 的本质

`struct` 定义数据，`impl` 定义行为，而 `mod` 定义**可见性边界**。三者处于不同维度：

| 概念 | 处理对象 | 解决的问题 |
|------|---------|-----------|
| `struct` | 数据 | 内存里存什么 |
| `impl` | 逻辑 | 数据能做什么 |
| `mod` | 边界 | 谁能看到、谁能用 |

没有 `mod`，代码库里所有东西都是全局可见的。`mod` 通过默认私有 + 显式 `pub` 的方式实现封装。

## mod 的核心能力

### 封装：默认私有

模块内部的所有东西（函数、结构体、字段）默认私有。可以把复杂逻辑拆成十个函数，只 `pub` 出去一个，外界不知道其他九个的存在。

### 文件即模块

创建 `network.rs` 时，Rust 自动创建名为 `network` 的模块。目录结构和逻辑结构强制挂钩，避免头文件乱飞。

### 命名空间隔离

不同 `mod` 中可以有同名类型（如 `database::User` 和 `api::User`），无需用前缀区分。

## 文件内再声明 mod 的场景

既然 `.rs` 文件本身就是一个模块，什么时候需要在文件内部再写 `mod`？

### 单元测试（最常见）

```rust
pub fn add(a: i32, b: i32) -> i32 { a + b }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_add() {
        assert_eq!(add(1, 2), 3);
    }
}
```

`#[cfg(test)]` 作用于整个 `mod`，测试代码不会编译进最终产物。

### 细粒度封装

在文件内部定义私有 `mod`，将辅助常量/函数限制在局部范围内，即使同文件的其他函数也拿不到：

```rust
pub fn decode_inst(code: u32) {
    table::lookup(code);
}

mod table {
    const MASK: u32 = 0xFF; // 仅 table 内可见
    pub fn lookup(c: u32) { /* ... */ }
}
```

### 避免文件碎片化

几个非常小但逻辑紧密的结构体，放在同一文件的不同 `mod` 中，物理上一个文件，逻辑上层次清晰：

```rust
pub mod cpu {
    pub struct Core;
    impl Core { pub fn reset(&self) {} }
}
pub mod bus {
    pub struct AxiBus;
}
```

## 嵌套 mod 的对外暴露

### "双重锁"原则

内部成员要 `pub`，它所在的 `mod` 也必须 `pub`：

```rust
pub mod cpu {
    pub mod alu {
        pub fn execute() { /* ... */ }
    }
}
// 外部：cpu::alu::execute()
```

### pub use 重新导出（门面模式）

把内部深处的模块"投影"到顶层，隐藏内部结构：

```rust
mod internal_logic {
    pub mod alu {
        pub fn execute() { /* ... */ }
    }
}
pub use internal_logic::alu;
// 外部只需：alu::execute()，不知道 internal_logic 的存在
```

### 结构体字段的"第三把锁"

即使 `mod` 和 `struct` 都 `pub`，字段没加 `pub` 外界依然不可访问：

```rust
pub mod cpu {
    pub struct Config {
        pub frequency: u64,  // 外部可访问
        secret_key: u32,     // 外部不可访问
    }
}
```

## 可见性阶梯

| 关键字 | 可见范围 | 适用场景 |
|--------|---------|---------|
| （无） | 仅当前模块及其子模块 | 绝对的内部细节 |
| `pub(super)` | 父级模块 | 模块内部拆分、局部助手 |
| `pub(crate)` | 整个项目（crate）内部 | 内部共享但不对外暴露 |
| `pub` | 全世界 | 公开 API |

### pub(crate) 场景

项目内多个模块需要共享，但不想暴露给外部用户（将 crate 作为库使用时）：

```rust
// src/common/mod.rs
pub(crate) struct InternalBusState {
    pub(crate) raw_bits: u64,
}
// 项目内任意模块可访问，外部依赖者看不到
```

### pub(super) 场景

将大模块拆分成子模块时，子模块的辅助函数只给父模块用：

```rust
// src/decoder.rs
mod bit_utils {
    pub(super) fn crack_instruction_bits(bits: u32) -> u32 {
        bits ^ 0x55AA
    }
}
pub fn decode(raw: u32) {
    let clean = bit_utils::crack_instruction_bits(raw); // OK
}
// 其他模块如 execute 无法直接调用 crack_instruction_bits
```

## mod 与 use 的区别

Rust 中**没有 `import` 关键字**。`mod` 和 `use` 是两个解耦的步骤：

| | `mod` | `use` |
|---|-------|-------|
| 本质 | 声明：告诉编译器"这里有代码，请编译" | 路径别名：给长路径起个短名 |
| 作用 | 构建项目的模块树 | 将树上的节点拉到当前作用域 |

```rust
mod decoder;           // 编译器去加载 decoder.rs
use decoder::decode;   // 之后可以直接写 decode() 而非 decoder::decode()
```

**外部 crate 例外**：`Cargo.toml` 中添加的依赖由 Cargo 自动处理加载，不需要写 `mod`，直接 `use` 即可。

## use 的导入语法

### 导入多个指定成员

```rust
use decoder::{Instruction, decode_raw};
```

### 嵌套路径

```rust
use std::collections::{HashMap, BTreeMap};
```

### 同时导入模块本身和成员（self）

```rust
use std::io::{self, Read};
// 可以用 Read trait，也可以用 io::Result
```

### 重命名（解决冲突）

```rust
use hardware::v1::Register as RegV1;
use hardware::v2::Register as RegV2;
```

### 避免 `*` 全导入

全导入（`use mod::*`）在大型项目中有风险：
- 不知道符号从何而来，降低可读性
- 两个模块新增同名符号时会编译失败
- 推荐显式列出需要的成员
