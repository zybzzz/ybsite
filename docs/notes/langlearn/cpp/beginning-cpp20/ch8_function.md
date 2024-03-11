# ch8 function

这篇文章主要讲函数定义。

## 指针传值与引用传值

对于指针传值和引用传值，有一些指导的原则：

- 指针传值能够接受空指针，但是引用传值不能接受空的引用，因此希望接受空指针作为参数的情况下应该使用指针传值。
- 尽量使用带 const 的引用，当然，这点没有强制规定。

## 引用和隐式转换

```cpp
#include <iostream>

void long_it(long &a){
    std::cout << "in long_it func" << std::endl; 
}

void print_it(const long &a){
    std::cout << a << std::endl;
}


int main(){
    int a {123};
    long_it(a); //error in this
    print_it(a);
    
    return 0;
}
```

这段程序会在调用 `long_it` 的时候出错，因为 `int` 类型的值在传参的时候不能转换成 `long &`。引用在不匹配的时候，进行比如这里的 `int` 转 `long` 的时候，会尝试进行隐式转换，产生一个临时值，由于这是一个临时值，函数中对引用的操作都作用在这个临时值上，且在最后可能还会进行临时值的缩窄转换，可能导致出错，cpp 设计者不希望这种临时值出现，因此禁止这种引用的传递，所以调用 `long_it` 的时候会出错。但是如果函数的参数是`const long &`就没事，因为这里虽然产生了临时值，但是指定的 `const` 认为不会对这个临时值进行更改，因此允许此种情况下的隐式转换存在。

## 函数默认参数

函数要指定默认参数，所有的参数都需要放在参数列表的最后。

## 引用的反汇编

为了理解引用在汇编层面的表示，对三种不同类型的变量进行反汇编，查看其汇编表示，主要的三个测试文件如下。分别是：函数接受引用且传递变量，函数接受const引用且传递变量，函数接受const引用且传递字面量。

```cpp
long func(long& a){
    return a * 2;    
}

int main(){
    long t {1000l};
    func(t);

    return 0;
}
```

```cpp
long func(const long& a){
    return a * 2;    
}

int main(){
    long t {1000l};
    func(t);

    return 0;
}
```

```cpp
long func(const long& a){
    return a * 2;    
}

int main(){
    func(1000l);

    return 0;
}
```

最后出人意料的是，三者的汇编都相同。

```asm
0000000000001130 <_Z4funcRKl>:
    1130: 55                    push   %rbp
    1131: 48 89 e5              mov    %rsp,%rbp
    1134: 48 89 7d f8           mov    %rdi,-0x8(%rbp)
    1138: 48 8b 45 f8           mov    -0x8(%rbp),%rax
    113c: 48 8b 00              mov    (%rax),%rax
    113f: 48 d1 e0              shl    %rax
    1142: 5d                    pop    %rbp
    1143: c3                    retq   
    1144: 66 66 66 2e 0f 1f 84  data16 data16 nopw %cs:0x0(%rax,%rax,1)
    114b: 00 00 00 00 00 

0000000000001150 <main>:
    1150: 55                    push   %rbp
    1151: 48 89 e5              mov    %rsp,%rbp
    1154: 48 83 ec 10           sub    $0x10,%rsp
    1158: c7 45 fc 00 00 00 00  movl   $0x0,-0x4(%rbp)
    115f: 48 c7 45 f0 e8 03 00  movq   $0x3e8,-0x10(%rbp)
    1166: 00 
    1167: 48 8d 7d f0           lea    -0x10(%rbp),%rdi
    116b: e8 c0 ff ff ff        callq  1130 <_Z4funcRKl>
    1170: 31 c0                 xor    %eax,%eax
    1172: 48 83 c4 10           add    $0x10,%rsp
    1176: 5d                    pop    %rbp
    1177: c3                    retq   
    1178: 0f 1f 84 00 00 00 00  nopl   0x0(%rax,%rax,1)
    117f: 00 
```

由此可以得到以下的结论：

- `const` 、引用都是编程语言的概念，而不是具体汇编的概念，它们的行为和规则都是由编译器控制的。
- 再给 `const` 类型的引用传递字面量的时候，实际上会产生一个临时的变量，就和这个变量 `t` 之前确实有被声明过一样。
- 传递引用反映到汇编层面实际上还是对地址的传递。
