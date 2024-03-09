# ch5 Arrays and Loops

## 逗号表达式

逗号可以用来连接两个表达式，逗号表达式的值等于后一个表达式的值， 注意智能连接表达式，不能连接声明初始化等等。

## `std::array` (cpp17)

使用 `std::array` 有如下好处:

- 安全。
- 可以通过 `std::size()` 获取数组长度。
- 对于同等长度的数组能够直接进行比较。

```cpp
#include <array>
#include <iostream>
#include <format>
#include <compare>

int main(){
    std::array<int, 5> a {1, 2, 3, 4, 5};
    std::array b {1, 2, 3, 4, 6};   //auto inference

    std::cout << std::format("len of a is {}", std::size(a)) << std::endl;

    std::weak_ordering ordering {a <=> b};

    std::cout << std::format("a < b : {}", std::is_lt(ordering)) << std::endl;

    return 0;

}
```
