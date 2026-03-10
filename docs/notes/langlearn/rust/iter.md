# Rust 迭代器

## 迭代器基础

Rust 中的迭代器基于 `Iterator` trait，核心只有一个方法：

```rust
trait Iterator {
    type Item;
    fn next(&mut self) -> Option<Self::Item>;
}
```

每次调用 `.next()` 返回 `Some(元素)`，耗尽后返回 `None`。后续再调也是 `None`。

### 三种获取迭代器的方式

```rust
let v = vec![1, 2, 3];

v.iter()        // 迭代 &T（借用）
v.iter_mut()    // 迭代 &mut T（可变借用）
v.into_iter()   // 迭代 T（消耗所有权）
```

`for x in &v` 等价于 `v.iter()`，`for x in v` 等价于 `v.into_iter()`。

### 范围迭代器

```rust
0..5        // [0, 1, 2, 3, 4]，不含右端点
0..=5       // [0, 1, 2, 3, 4, 5]，含右端点
(1..=10).rev()  // 反向：10, 9, ..., 1
```

## 惰性与消费：核心区分

Rust 迭代器的方法分两类：**适配器（Adapter）** 返回新的迭代器，是惰性的；**消费者（Consumer）** 触发实际计算，驱动整个链条执行。

> 如果链条末端没有消费者，前面所有适配器的闭包都不会执行。

### 惰性适配器（返回迭代器，不执行）

| 方法 | 作用 |
| --- | --- |
| `.map(f)` | 对每个元素应用 `f`，转换类型 |
| `.filter(f)` | 保留满足条件的元素 |
| `.filter_map(f)` | `filter` + `map` 合一，`f` 返回 `Option` |
| `.flat_map(f)` | `map` 后展平一层嵌套 |
| `.flatten()` | 展平一层嵌套（`Option`/`Result`/迭代器） |
| `.take(n)` | 只取前 n 个 |
| `.take_while(f)` | 取到条件不满足为止 |
| `.skip(n)` | 跳过前 n 个 |
| `.skip_while(f)` | 跳过直到条件不满足 |
| `.enumerate()` | 附加索引，产出 `(index, value)` |
| `.zip(other)` | 将两个迭代器配对，产出 `(a, b)` |
| `.chain(other)` | 串联两个迭代器 |
| `.peekable()` | 允许 `.peek()` 预览下一个元素而不消费 |
| `.inspect(f)` | 对每个元素执行 `f`（用于调试），不改变元素 |
| `.rev()` | 反向迭代（要求 `DoubleEndedIterator`） |
| `.cloned()` | 将 `&T` 克隆为 `T` |
| `.copied()` | 将 `&T` 复制为 `T`（要求 `T: Copy`） |
| `.step_by(n)` | 每隔 n 个取一个 |
| `.fuse()` | 保证 `None` 之后永远返回 `None` |
| `.scan(state, f)` | 带状态的 `map`，可提前终止 |

### 消费者（触发执行，返回具体值）

| 方法 | 作用 |
| --- | --- |
| `.collect()` | 收集到目标容器 |
| `.count()` | 计数 |
| `.sum()` | 求和 |
| `.product()` | 求积 |
| `.min()` / `.max()` | 最小/最大值 |
| `.min_by(f)` / `.max_by(f)` | 自定义比较的最小/最大 |
| `.fold(init, f)` | 累积计算（通用归约） |
| `.reduce(f)` | 类似 `fold` 但初始值是第一个元素 |
| `.for_each(f)` | 对每个元素执行副作用 |
| `.find(f)` | 找到第一个满足条件的元素 |
| `.position(f)` | 找到第一个满足条件的索引 |
| `.any(f)` | 是否存在满足条件的（短路） |
| `.all(f)` | 是否全部满足条件（短路） |
| `.last()` | 取最后一个元素 |
| `.nth(n)` | 取第 n 个元素 |
| `.unzip()` | 将 `(A, B)` 的迭代器拆成两个集合 |

### 惰性陷阱

```rust
// 错误：map 是惰性的，闭包不会执行
let mut count = 0;
v.iter().map(|x| { count += 1; });  // count 仍然是 0

// 正确：用消费者驱动
v.iter().for_each(|_| { count += 1; });
// 或更好：
let count = v.iter().count();
```

用 `.map()` 做副作用（修改外部变量）不是惯用写法，应当用 `.for_each()` 或对应的消费者方法。

## collect() 的类型驱动行为

`collect()` 的行为由目标类型决定，本质是调用目标类型的 `FromIterator` 实现。同一个迭代器，指定不同返回类型，行为完全不同：

```rust
let iter = [Ok(1), Err("bad"), Ok(3)].into_iter();

// 收集为 Vec<Result<...>> → 保留每个元素
let a: Vec<Result<i32, &str>> = iter.clone().collect();
// → [Ok(1), Err("bad"), Ok(3)]

// 收集为 Result<Vec<...>> → 遇错短路
let b: Result<Vec<i32>, &str> = iter.collect();
// → Err("bad")
```

### 常见 FromIterator 实现

| 目标类型 | 迭代器元素 | 行为 |
| --- | --- | --- |
| `Vec<T>` | `T` | 逐个收集 |
| `String` | `char` 或 `&str` | 拼接成字符串 |
| `HashMap<K, V>` | `(K, V)` | 构建映射 |
| `Result<Vec<T>, E>` | `Result<T, E>` | 全部 `Ok` 则返回 `Ok(Vec)`，遇 `Err` 短路 |
| `Option<Vec<T>>` | `Option<T>` | 全部 `Some` 则返回 `Some(Vec)`，遇 `None` 短路 |

### 为什么默认用 Result\<Vec\<T\>, E\> 而非 Vec\<Result\<T, E\>\>

在大多数场景中，一批操作只要有一个失败，整体就应该失败，和 `?` 操作符理念一致。返回 `Vec<Result<T, E>>` 意味着调用方还得自己遍历每个元素处理错误，相当于把问题推迟了。

`Vec<Result<T, E>>` 适用于需要知道哪些成功哪些失败的场景（部分重试、生成报告），但这是少数情况。

## 处理嵌套数据结构

### flatten：展平一层

将嵌套的迭代器/`Option`/`Result` 展平一层：

```rust
let nested = vec![vec![1, 2], vec![3, 4]];
let flat: Vec<i32> = nested.into_iter().flatten().collect();
// → [1, 2, 3, 4]

// 过滤掉 None，提取 Some 中的值
let options = vec![Some(1), None, Some(3)];
let values: Vec<i32> = options.into_iter().flatten().collect();
// → [1, 3]
```

### flat_map：map + flatten

对每个元素应用产出迭代器的函数，然后展平结果。等价于 `.map(f).flatten()`：

```rust
// 遍历外层 slice，收集内层 HashMap 的所有值
fn count_all(collection: &[HashMap<String, Progress>], value: Progress) -> usize {
    collection.iter()
        .flat_map(|map| map.values())  // 展平所有 HashMap 的值
        .filter(|v| **v == value)
        .count()
}
```

### filter 中的多层引用

`.filter()` 的闭包接收的是迭代器元素的**引用**。如果迭代器产出的已经是引用（如 `.values()` 产出 `&V`），闭包参数就会是 `&&V`：

```rust
// .values() → &Progress
// .filter() 闭包参数 → &&Progress
// 需要 ** 解两层
map.values().filter(|v| **v == value).count()

// 或用模式匹配解一层
map.values().filter(|&v| *v == value).count()
```

### 嵌套处理方法全览

| 方法 | 作用 | 场景 |
| --- | --- | --- |
| `.flatten()` | 展平一层嵌套 | `Vec<Vec<T>>` → `Vec<T>` |
| `.flat_map(f)` | map 后展平 | 每个元素产出多个结果 |
| `.chain(other)` | 串联两个迭代器 | 合并多个来源 |
| `.zip(other)` | 配对两个迭代器 | 并行遍历两个集合 |
| `.unzip()` | 拆分 `(A, B)` 对 | 一个迭代器拆成两个集合 |
| `.enumerate()` | 附加索引 | 需要位置信息 |
| `.fold(init, f)` | 通用归约 | 构建任意聚合结果 |
| `.scan(state, f)` | 带状态遍历 | 需要在元素间传递中间状态 |

### 实际例子：多层嵌套的函数式处理

```rust
// 场景：从多个班级中筛选出所有及格学生的姓名
let classes: Vec<Vec<Student>> = get_classes();

let passed_names: Vec<&str> = classes.iter()
    .flat_map(|class| class.iter())       // 展平班级
    .filter(|s| s.score >= 60)            // 筛选及格
    .map(|s| s.name.as_str())             // 提取姓名
    .collect();

// 场景：多个文件，每行解析为数字，收集所有成功解析的值
let all_numbers: Vec<i32> = files.iter()
    .flat_map(|f| f.lines())              // 展平所有行
    .filter_map(|line| line.parse().ok()) // 解析成功的保留
    .collect();

// 场景：分组统计
let group_counts: HashMap<&str, usize> = items.iter()
    .fold(HashMap::new(), |mut acc, item| {
        *acc.entry(item.category).or_insert(0) += 1;
        acc
    });
```

## 字符串拼接

字符串操作与迭代器紧密相关，总结常用拼接方式：

| 场景 | 推荐方式 | 原因 |
| --- | --- | --- |
| 多个 `&str` 拼接 | `format!("{}{}", a, b)` | 通用，可读性好 |
| 同一分隔符连接 | `["a", "b"].join(", ")` | 简洁 |
| 在已有 `String` 上追加 | `s.push_str("...")` | 原地修改，性能最优 |
| 循环中大量拼接 | `String::with_capacity` + `push_str` | 减少重分配 |
| `+` 运算符 | `String + &str` | 消耗左侧所有权，链式可读性差，一般不推荐 |

## 常用组合速查

```rust
(1..=n).sum::<u64>()            // 累加
(1..=n).product::<u64>()        // 累乘
v.iter().enumerate()             // 带索引遍历
v.iter().zip(w.iter())           // 并行遍历两个集合
v.iter().cloned().collect()      // &T 转 T 后收集
v.iter().copied().collect()      // &T 转 T（Copy 类型）
v.windows(3)                     // 滑动窗口（宽度 3）
v.chunks(2)                      // 按 2 个分组
```
