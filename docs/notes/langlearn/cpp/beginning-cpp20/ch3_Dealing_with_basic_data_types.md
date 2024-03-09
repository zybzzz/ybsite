# ch3 Dealing with basic data types

## 运算符的优先级和相关性

主要是对运算符的相关性的理解，运算符的相关性是指在优先级相同的情况下，计算是从左到右还是从右到左的，左集合表示计算顺序是从左到右的，右结合表示运算符计算顺序是从右到左的。主要记住的右结合运算符是一元运算符和赋值运算符。对于优先级不多记，必要的时候加括号保证优先级。

## auto 使用和整形提升

在 cpp 的世界从，所有的运算符最低都是对 int 长度进行计算的，这就意味着你提供一个短于 int 的数据类型，默认是会对其在计算的时候进行整形提升转换成 int 类型，然后再去做计算，计算完成之后再转换回来。这种时候最好施以手动的转换，避免出错，这也是 auto 非常好的使用场景。

```cpp
#include <iostream>
#include <format>


int main(){
    unsigned char a{5};
    unsigned char b{6};
    auto c {static_cast<unsigned char>(a + b)};

    std::cout << std::format("c is {}", c) << std::endl;

    return 0;
}
```

像这种在 static_cast 中已经指明了类型，使用auto更加方便。

## 名称空间

主要讲的是全局名称空间中的初始化顺序。对于 cpp 而言，全局的名称空间是最先初始化的，但是初始化顺序是不一定的。匿名的名称空间和全局一样也是最先初始化的，但是匿名的名称空间仅在定义匿名的名称空间内是可见的。简单的例子是：

```cpp
#include <iostream>
#include <format>

namespace {
    int x {5};
    
}

int main(){
    std::cout << "x value is " << x << std::endl;

    return 0;
}
```

在匿名的名称空间中不允许调用函数，这个很好想象，本来你也没在全局的名称空间中直接调用函数。可以采取类的初始方式进行函数的调用:

```cpp
#include <iostream>
#include <format>

namespace {
    class Helper;
    int x {5};
    
    auto test() -> void{
        std::cout << "do something in init" << std::endl;
    }

    class Helper{
        public:
        Helper(){
            test();
        }
    };

    Helper h{};
}



int main(){
    std::cout << "x value is " << x << std::endl;

    return 0;
}

```

这是一种很好的绕过方法。

## 强类型枚举

这是 cpp20 中的新枚举，枚举的时候要用 ```::``` 来指定属于哪个枚举，这是 cpp20 的新特性。
