# ch15 polymorphism

这部分介绍 cpp 的多态性。

## 虚函数相关

在写虚函数的时候可能会用到 `virtual` 关键字，在重写虚函数的时候会用到 `override` 关键字，这些关键字都是在类声明中使用的，而不能在类定义中使用。这是 cpp 规定的规则，显然在声明中使用就能获取到虚函数或者重写的信息，而不需要在定义中重复出现。

几乎在任何情况下，虚函数在派生类中进行重写的时候都需要保证函数签名完全相同，否则重写就是失败的。但是特殊的情况是虚函数返回的是 `this`、`*this` 指针和引用的情况，这种情况下派生类在重写的时候可以返回当前派生类型的指针和引用，这体现出 cpp 的协变性。

使用 `final` 关键字能够让派生类不再能够重写当前的函数。

### 访问修饰符与虚函数

<!-- 访问修饰符是一个属于静态编译期的概念，不管是对于成员的访问修饰符还是类继承的时候对类的访问修饰符都是工作在静态编译时期的。这就意味着静态编译时期对于访问修饰符的检查通过之后，在运行时就不会再检查访问修饰符。 -->

首先不谈虚函数，先谈在类的继承过程中出现函数函数重名的现象，先理解函数重名和重写的概念。

```cpp
#include <iostream>

class A{
    public:
        A() = default;
        void func(){
            std::cout << "in A" << std::endl;
        }
    private:

    protected:
};

class B: public A{
    public:
        B() = default;
        void func() {
            std::cout << "in B" << std::endl;
        }
    private:

    protected:

};

int main(){
    A a{};
    B b{};

    a.func();
    b.func();
    b.A::func();

    return 0;
}
```

```bash
(base) zybzzz@zybzzz-lm:~/proj/begincpp20/ch14$ ./test3 
in A
in B
in A
```

在以上的代码中，基类和派生类之间出现了函数的同名，但是可以看到的是同名没有带来任何的影响，因为基类作用域和派生类的作用域本身就是不一样的，同名并不会导致冲突，在下面的 `main` 函数进行调用的时候，所有的调用都在静态解析，正确的指定要输出的结果。

当你的要重名的函数变为虚函数的时候同样是这样的道理，这个过程叫做重写，虽然虚函数是动态的特性，但是这个动态特性只有在指针或者引用的情况下才开启。正常的情况下，你在基类中声明的虚函数，在派生类中的访问修饰符是不必与基类相同的，就跟你上面一样，因为本身派生类和基类就是不同的作用域，修改访问修饰符并不会产生什么影响。因此在不使用其动态特性的情况，同普通的方法没什么不同。但是在使用指针或者引用的情况下，动态特性启用，会出现下面的情况：

```cpp
#include <iostream>

class A{
    public:
        A() = default;
        virtual void func(){
            std::cout << "in A" << std::endl;
        }
    private:
    protected:
};

class B: public A{
    public:
        B() = default;
    private:
        virtual void func() override{
            std::cout << "in B" << std::endl;
        }
    protected:

};

int main(){
    A a{};
    B b{};
    A *pa = &a;
    A *pb = &b;
    pa->func();
    pb->func();

    return 0;
}
```

```bash
(base) zybzzz@zybzzz-lm:~/proj/begincpp20/ch14$ ./test2 
in A
in B
```

这里竟然通过了 `A` 类的指针调用了 `B` 类中的 `private` 函数，原因在于访问修饰符是一个属于静态编译期的概念，不管是对于成员的访问修饰符还是类继承的时候对类的访问修饰符都是工作在静态编译时期的。这就意味着静态编译时期对于访问修饰符的检查通过之后，在运行时就不会再检查访问修饰符。在这里编译器在编译期检查的是 `A` 类对于 `func` 的访问修饰符，在检查通过之后，在运行期就不在检查。因此，即使 `B` 中的 `func` 是 `private` 的，也能通过 `A` 的指针用多态的特性调用到。

### 默认参数与虚函数

默认参数同样工作在静态的编译期，因此也是在编译期通过谁调用，用的就是谁在声明的时候使用的默认参数。

### 虚析构函数

因为存在基类指针指向派生类的情况，在这种情况下，对象被释放的时候所要做的操作应该是针对不同的类型调用其析构函数，因此为了解决这个问题，需要将析构函数变成虚的。即虚析构函数。

## 构造函数和析构函数顺序

一个对象在构造的时候是从基类到派生类的顺序，一个对象在释放的时候是从派生类到基类的顺序。在编写构造或者析构函数的时候，想到这个顺序，你就知道什么东西能访问到，什么东西访问不到了。
