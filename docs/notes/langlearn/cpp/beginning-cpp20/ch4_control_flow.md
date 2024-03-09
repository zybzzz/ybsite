# ch4 Control Flow

## 飞碟运算符比较

飞碟运算符进行数值的比较，等于说是吧结果封装到了一个 order 类型中。

```cpp
#include <iostream>
#include <compare>
#include <format>

int main(){
    int a{5};
    int b{6};

    std::strong_ordering order = a <=> b;

    std::cout << std::format("a > b {}", order == std::strong_ordering::greater) << std::endl;
    std::cout << std::format("a = b {}", order == std::strong_ordering::equal) << std::endl;
    std::cout << std::format("a < b {}", order == std::strong_ordering::less) << std::endl;

    std::cout << std::format("a > b {}", std::is_gt(order)) << std::endl;

    return 0;
}
```

整数和指针使用 `strong_ordering`，浮点用 `partial_ordering`，用户自定义类型使用 `weak_ordering`。

## 带初始化的 if 语句

```cpp
#include <iostream>
#include <cctype>

int main(){
    if(auto ch{static_cast<char>('a')}; std::islower(ch)){
        std::cout <<  "yes" << std::endl;
    }

    return 0;
}
```

包括在 `while` 和 `switch` 中应该都有这样的语法。
