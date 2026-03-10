# 类型转换 trait

## From 与 Into

`From` 和 `Into` 是 Rust 中最基础的值转换 trait，用于将一种类型转换为另一种类型。它们是一对互逆关系：**实现了 `From` 就自动获得 `Into`**。

### From：定义"如何从别人变成我"

`From<T>` 定义在目标类型上，表示"我知道如何从 `T` 构造出自己"：

```rust
// 标准库已有的实现：
let s: String = String::from("hello");   // String 实现了 From<&str>
let n: i64 = i64::from(42i32);          // i64 实现了 From<i32>
```

自定义实现：

```rust
struct Color {
    red: u8,
    green: u8,
    blue: u8,
}

// 为 Color 实现 From<(u8, u8, u8)>
// 含义：Color 知道如何从元组构造自己
impl From<(u8, u8, u8)> for Color {
    fn from(tuple: (u8, u8, u8)) -> Self {
        Color {
            red: tuple.0,
            green: tuple.1,
            blue: tuple.2,
        }
    }
}

let c = Color::from((255, 128, 0));
```

**谁向谁转换**：`impl From<源类型> for 目标类型` — 从源类型转换**到**目标类型。`From` 写在目标类型身上。

### Into：定义"如何把我变成别人"

`Into<T>` 是 `From` 的反向视角。实现了 `From<A> for B` 后，`A` 自动获得 `Into<B>`：

```rust
// 因为 String 实现了 From<&str>
// 所以 &str 自动获得 Into<String>
let s: String = "hello".into();

// 因为 Color 实现了 From<(u8, u8, u8)>
// 所以 (u8, u8, u8) 自动获得 Into<Color>
let c: Color = (255, 128, 0).into();
```

**只需实现 `From`，`Into` 免费获得**。几乎不需要手动实现 `Into`。

### 调用方式的区别

```rust
// From：显式调用，类型明确
let c = Color::from((255, 128, 0));

// Into：需要类型推断或标注，因为编译器不知道要 into 成什么
let c: Color = (255, 128, 0).into();
```

`From` 不依赖上下文，适合独立使用。`Into` 通常用在泛型函数参数中，让 API 更灵活：

```rust
// 接受任何能转换为 Color 的类型
fn paint(color: impl Into<Color>) {
    let c: Color = color.into();
    // ...
}

paint((255, 128, 0));  // 传元组，自动转换
paint(Color::from((0, 0, 0))); // 直接传 Color 也行
```

## TryFrom 与 TryInto

`From`/`Into` 是不会失败的转换。当转换可能失败时，使用 `TryFrom`/`TryInto`，返回 `Result`：

```rust
use std::convert::TryFrom;

impl TryFrom<(i16, i16, i16)> for Color {
    type Error = String;

    fn try_from(tuple: (i16, i16, i16)) -> Result<Self, Self::Error> {
        let (r, g, b) = tuple;
        if r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255 {
            return Err(format!("值超出范围: ({r}, {g}, {b})"));
        }
        Ok(Color {
            red: r as u8,
            green: g as u8,
            blue: b as u8,
        })
    }
}

let c = Color::try_from((255, 128, 0));   // Ok(Color { ... })
let c = Color::try_from((256, 0, 0));     // Err("值超出范围: (256, 0, 0)")

// 同样，TryInto 自动获得
let c: Result<Color, _> = (255, 128, 0).try_into();
```

### From / TryFrom 选择

| | `From` | `TryFrom` |
| --- | --- | --- |
| 返回值 | `T`（直接返回目标类型） | `Result<T, E>` |
| 适用场景 | 转换一定成功 | 转换可能失败 |
| 示例 | `i32` → `i64`（无损） | `i64` → `i32`（可能溢出） |

## AsRef 与 AsMut

`AsRef` 和 `AsMut` 是**轻量级引用转换**，不创建新值，只是换一种方式看待已有数据。

### AsRef\<T\>："我能廉价地变成 &T"

```rust
// String 实现了 AsRef<str>
let s = String::from("hello");
let r: &str = s.as_ref();

// Vec<u8> 实现了 AsRef<[u8]>
let v = vec![1, 2, 3];
let r: &[u8] = v.as_ref();

// str 实现了 AsRef<[u8]>
let r: &[u8] = "hello".as_ref();
```

### AsMut\<T\>："我能廉价地变成 &mut T"

```rust
// Vec<T> 实现了 AsMut<[T]>
let mut v = vec![1, 2, 3];
let slice: &mut [i32] = v.as_mut();
slice[0] = 99;
```

### 核心用途：让函数接受多种类型

不加 trait bound 的函数只能接受固定类型。用 `AsRef` 可以让函数接受任何"能转成目标引用"的类型：

```rust
// 不灵活：只接受 &str
fn byte_count(s: &str) -> usize {
    s.len()
}

// 灵活：接受 String、&str、&String 等任何实现了 AsRef<str> 的类型
fn byte_count<T: AsRef<str>>(s: T) -> usize {
    s.as_ref().len()
}

byte_count("hello");                // &str
byte_count(String::from("hello"));  // String
byte_count(&String::from("hello")); // &String
```

### AsMut 实战

```rust
fn square<T: AsMut<u32>>(arg: &mut T) {
    let num = arg.as_mut();  // 拿到 &mut u32
    *num = *num * *num;      // 解引用后计算，再写回
}

let mut boxed = Box::new(5u32);
square(&mut boxed);  // Box<u32> 实现了 AsMut<u32>
assert_eq!(*boxed, 25);
```

为什么需要 `*num`：`num` 的类型是 `&mut u32`（可变引用），不是 `u32`。`*num` 解引用拿到值，`*num = ...` 把结果写回引用指向的内存。方法调用（如 `num.pow(2)`）会自动解引用，但赋值左边必须手写 `*`。

## From/Into vs AsRef/AsMut

| | `From` / `Into` | `AsRef` / `AsMut` |
| --- | --- | --- |
| 转换方式 | 创建新值（值转换） | 借用转换（引用转换） |
| 开销 | 可能分配内存 | 零开销，只是换个类型看同一块内存 |
| 所有权 | 消耗或复制源值 | 只借用 |
| 典型场景 | `&str` → `String`、元组 → 结构体 | 让函数同时接受 `String` 和 `&str` |

```rust
// From：创建了一个新的 String
let s = String::from("hello");

// AsRef：没有创建新值，只是把 String 当 &str 看
let r: &str = s.as_ref();
```

## 标准库中常见的转换实现

### From 实现

| 源类型 | 目标类型 | 说明 |
| --- | --- | --- |
| `&str` | `String` | 分配堆内存拷贝 |
| `i32` | `i64` | 无损扩展 |
| `Vec<u8>` | `String` | UTF-8 有效时（`from_utf8` 用 `TryFrom`） |
| `T` | `Option<T>` | `Some(T)` |
| `bool` | `i32` | `true → 1`，`false → 0` |

### AsRef 实现

| 类型 | `AsRef` 目标 | 说明 |
| --- | --- | --- |
| `String` | `str` | 看成字符串切片 |
| `String` | `[u8]` | 看成字节切片 |
| `Vec<T>` | `[T]` | 看成切片 |
| `Box<T>` | `T` | 看成内部值 |
| `str` | `[u8]` | 字符串的 UTF-8 字节 |
| `Path` | `OsStr` | 路径当 OS 字符串 |

## 转换 trait 速查

```text
值转换（创建新值）：
  不会失败 → From / Into      （实现 From，自动获得 Into）
  可能失败 → TryFrom / TryInto （实现 TryFrom，自动获得 TryInto）

引用转换（零开销借用）：
  不可变 → AsRef<T>            （&Self → &T）
  可变   → AsMut<T>            （&mut Self → &mut T）

显示转换：
  ToString / Display           （Display 自动获得 ToString）
  FromStr                      （"hello".parse::<T>() 的底层）
```
