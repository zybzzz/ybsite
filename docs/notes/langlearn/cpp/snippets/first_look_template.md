# 模板初探

模板，是现代 cpp 的重要特性，是 cpp 的静态多态的重要体现。最简单的理解是只需要写一份代码，就能各种实例化模板，减少重复代码的编写。最浅显的好处是方便，最浅显的坏处是代码的膨胀，每次实例化都会完成一个完整的类的代码生成。模板不只是只有类型模板，还有参数模板，即直接传入一个数值作为模板实例化的参数，最大的好处是将一些数值的确定放到了编译期，减小了一点运行时候的任务，缺点还是和之前一样，可能会带来代码的膨胀。将部分数值的设定移动到编译期，从而减轻运行时候的负担，这是最八股文的说法，到底降低在了哪里，这是值得去探讨的，下面的描述就想基于这点来展开。

还有一点想说的是，世界上没有完美的事。提供了静态多态的便利，带来的缺点是代码的膨胀。提供了静态编译时候确定数值的能力、运行时候的负担的减轻，带来的缺点是编译期的时间增长。但是对于 cpp 这种追求效率的语言来说，编译期时间的增长是可以忍受的。现在 cpp 的特性，很多也都是想完善这些缺点，减小这些缺点带来的影响，更好的使用优点。比如说：

1. trait 库的推出。在模板的内部还能使用库中相关的特性对模板的类型参数进行相关的判断，能够针对不认同的参数控制模板类内部代码的生成，对于某些模板参数不需要的类功能，可以直接不进行相关的代码生成，控制了代码的体积，减小了编译的时间。
2. 元编程。不太懂概念，但是核心的理念是面向编译期编程。既然模板提供了编译器确定值的能力，何不利用这种能力进行大量的编译期间的计算，节省运行时候的时间，这就是面向编译期的编程。

## 编译时候确定值的重要性

编译时候确定值的重要性，编译时候确定值的重要性到底在哪里？

### 编译器优化：编译器可以执行诸如常量折叠、死代码消除和循环展开等优化

最典型的是：

```cpp
for (int i = 0; i < ARRAY_SIZE; ++i) {
        sum += arr[i];
}
```

如果值在编译的时候已知，可以优化成：

```cpp
sum = arr[0] + arr[1] + arr[2] + arr[3];
```

### 高效的内存布局：提前知道大小和配置，可以进行高效的内存分配和访问模式

最典型的是：

```cpp
template <size_t Rows, size_t Cols>
class Matrix {
public:
    constexpr float data[Rows][Cols];

    void initialize(float value) {
        for (size_t i = 0; i < Rows; ++i) {
            for (size_t j = 0; j < Cols; ++j) {
                data[i][j] = value;
            }
        }
    }
};
```

在编译的时候可以确定布局，将实例分配到栈上或者是数据段上，同时在分配的时候考虑缓存友好性。同时针对对于数组的循环，由于编译的时候数值已知，就能在编译的时候进行相关的循环优化。

### 无需运行时检查：消除了运行时检查和计算的需要，减少了指令数量和执行时间

最典型的是：

```cpp
template <size_t N>
int getElement(const int (&arr)[N], size_t index) {
    static_assert(N > 0, "Array size must be greater than zero.");
    assert(index < N); // 运行时检查

    return arr[index];
}
```

可以转换成：

```cpp
template <size_t N, size_t Index>
int getElement(const int (&arr)[N]) {
    static_assert(Index < N, "Index out of bounds.");
    return arr[Index];
}
```

等于消除了运行时候的断言，一次运行时候的断言，相当于进行一次分支。这样相当于将分支指令的执行从运行期转移到了编译期，这是非常大的一点优化。

## 编译 vs 运行

对于编译时候的值确定：

```cpp
template <int N>
class Test {
public:
    constexpr int = N;
};
```

运行时候确定：

```cpp
class Test {
public:
    int = 2;
};
```

后者相当于在构造函数中才进行值的确定，是一个运行时候的值，因此对其的访问是访问内存的。相反由于前者的值在编译期生成，相当于其值已经能够在编译期确定，并在运行时间不变，因此访问他的时候直接生成立即数就行了，而不需要访问内存。相当于一个是 `li r1, N` 而另一个是 `ld r1, (r2)` 这个效率差别是不言而喻的。

## 消除虚函数的开销

这段直接抄的 gpt：

```cpp
#include <iostream>

class Shape {
public:
    virtual double area() const = 0; // 纯虚函数
};

class Circle : public Shape {
public:
    Circle(double r) : radius(r) {}
    double area() const override {
        return 3.14159 * radius * radius;
    }
private:
    double radius;
};

class Square : public Shape {
public:
    Square(double s) : side(s) {}
    double area() const override {
        return side * side;
    }
private:
    double side;
};

void printArea(const Shape* shape) {
    std::cout << "Area: " << shape->area() << std::endl;
}

int main() {
    Circle circle(5.0);
    Square square(4.0);

    printArea(&circle);
    printArea(&square);

    return 0;
}

```

用模板消除虚函数的开销：

```cpp
#include <iostream>

template <typename ShapeType>
class Shape {
public:
    Shape(const ShapeType& shape) : shapeInstance(shape) {}

    double area() const {
        return shapeInstance.area();
    }

private:
    ShapeType shapeInstance;
};

class Circle {
public:
    Circle(double r) : radius(r) {}
    double area() const {
        return 3.14159 * radius * radius;
    }
private:
    double radius;
};

class Square {
public:
    Square(double s) : side(s) {}
    double area() const {
        return side * side;
    }
private:
    double side;
};

template <typename ShapeType>
void printArea(const Shape<ShapeType>& shape) {
    std::cout << "Area: " << shape.area() << std::endl;
}

int main() {
    Circle circle(5.0);
    Square square(4.0);

    Shape<Circle> circleShape(circle);
    Shape<Square> squareShape(square);

    printArea(circleShape);
    printArea(squareShape);

    return 0;
}
```

通过使用模板消除虚函数的开销。这种情况适合编译时候已经知道接下来已经知道使用哪个虚函数的场景，比如我自己抽象了一个抽象类，在试两种不同的实现，并且我自己能够确定使用其中的哪一种。但是对于动态时候，比如别人给我传个指针，是无法使用模板消除开销的，还是老老实实使用虚函数吧。

