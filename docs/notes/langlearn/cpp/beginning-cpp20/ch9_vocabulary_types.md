# ch9 vocabulary types

词汇类型通常指的是一组广泛使用的类型，它们为不同的库和组件之间的交互提供了一个共同的基础。在 cpp 中，后续又引入了 `optional` 、`string_view` 、`span` 等词汇类型，方便了编程与传参。

## `optional`

`optional` 类型代表的是对于一个值得封装，重点是对于任何 `optional<T>`， `optional` 都有空值的类型，等于说在想要空值的时候可以使用 `std::nullopt` 来替代，而不用从类型 `T` 中专门找一个空值。

## `string_view`

`string_view` 主要用来提供对字符串的视图，解决传参时候对字符串的拷贝问题，对于如下代码：

```cpp
#include <string>
#include <string_view>

void func1(const std::string& str){

}

void func2(std::string_view str){

}

int main(){
    func1("long string...");
    func2("long string...");

    return 0;
}
```

在将字面量传入 `func1` 的时候，由于 `const std::string&` 指向的是字面量，因此会创建新的临时值，引起大量的字符串拷贝。而 `func2` 用来解决问题， `string_view` 可以直接指向这个字面量，而不需要复制。在进行函数调用传参的时候可以直接传 `string_view`，而不需要 `const string_view&`，因为 `string_view` 内部本身就只含指针等信息，其大小差不多就等于两个 `long` 的长度，因此可以直接传递。`string_view` 不能通过任何操作改变它指向的字符串。

## `span`

引入的 `span` 也是解决之前和 `string_view` 类似，也是解决拷贝问题，实际上 `string_view` 几乎等同于 `span<const char>`。`span` 用于指向一个顺序的队列，也是避免拷贝的问题。`span` 指向的队列是能够改动的，如果不想指向的序列被改动应该用 `span<const T>` 将模板例化。另外在调用 `span` 初始化函数的时候，如果传入的是指针，则必须指定长度，如果传入的是数组名，可以不指定长度，因为编译器能够自动推断。
