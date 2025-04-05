# metaclass and class defination in python

这篇文章主要讲述 python 中的元类，python中的元类是类的工厂，是创建类的类，类的创建（注意：不是类的实例的创建）是由元类控制的，因此，元类可以为类增加动态属性。为了区分类的创建和类实例的创建，编写了如下代码做过程的理解。

```python
class C(type):
    def __new__(cls, name, bases, dct):
        print(cls)
        print("in metaclass c new")
        return super().__new__(cls, name, bases, dct)
    
    def __init__(cls, name, bases, dct):
        print(cls)
        print(name)
        print("in metaclass c init")
        return super().__init__(name, bases, dict)
    
class B(object):
    def __init__(self) -> None:
        print("in b init")
        return
    
class A(B, metaclass = C):
    def __init__(self) -> None:
        super().__init__()
        print("in a init")
        
print("before create")
a = A()
print("after create")
print()
```

## 类的创建

首先有一个基本事实就是 python 中所有类都有公共的元类 `type` ，在看一段引用自 chatgpt4 的回答：

> ### 类的创建过程
>
> - 收集类定义：Python收集类A的定义，包括所有的属性和方法。
>
> - 确定元类：Python确定用于创建类A的元类。因为你指定了元类为C，所以Python会使用C作为元类。如果你没有指定元类，Python会从基类B中查找元类，如果B也没有指定元类，那么最终会使用内置的type类作为元类。
>
> - 调用元类的__new__方法：Python使用元类C的__new__方法来创建类A的对象。这个方法通常接收四个参数：元类本身、类的名称、基类的元组和类的属性字典。
>
> - 调用元类的__init__方法：一旦类对象被创建，元类C的__init__方法会被调用来初始化类对象。这个方法通常接收相同的参数：类对象、类的名称、基类的元组和类的属性字典。
>
> - 类对象完成创建：此时，类A已经被成功创建，并且可以用来创建实例。

因此可以看到，在类创建的时候，同类的基类是没有任何关系的，顶多只记录基类的信息。在类创建的时候会先去调用元类的__new__方法，元类在逐步往上调__new__方法，直到最后调到默认的 `type` 元类的__new__方法。在执行完成__new__方法之后，再进行__init__的方法调用。这个__new__方法的调用机制也决定了为什么代码中是 `return super().__new__(cls, name, bases, dct)` 这样的写法，这样的写法正好符合的是层层调用的逻辑。

在创建对象之前，这段代码的执行结果是：

```bash
<class '__main__.C'>
in metaclass c new
<class '__main__.A'>
A
in metaclass c init
```

## 类实例的创建

首先有的事实是所有的 python 类都有一个公共的基类 `object` ，在看一段来自 chatgpt4 的回答：

> ### 类实例的创建过程
>
> - 调用类的__new__方法：当你创建类A的实例时，Python会调用A的__new__方法来创建一个新的实例。如果A没有定义__new__方法，Python会查找基类B的__new__方法，如果B也没有定义，那么最终会调用object类的__new__方法。
>
> - 调用实例的__init__方法：一旦实例被创建，类A的__init__方法会被调用来初始化这个实例。同样，如果A没有定义__init__方法，Python会查找基类B的__init__方法，如果B也没有定义，那么实例初始化过程就会跳过（因为object类的__init__方法什么也不做）。
>
> - 实例完成创建：此时，类A的实例已经被成功创建并初始化。
>

可以看到在类实例创建的时候，是不涉及到元类的，只是涉及到基类，在类实例创建的时候往往先创建父类的实例，在父类的实例创建完成之后再创建自己的，这也是为什么 `super().__init__()` 写在初始化方法第一行的原因。

最终得到的结果如下：

```bash
before create
in b init
in a init
after create
```

## 在 import 导入时

当你在 python 中导入一个模块时，这个模块的代码将会被执行，包括类定义的代码。因此当代码中的类有元类的时候，当进行 import 导入模块的时候，元类会开始类创建的工作。

## 元类中的方法

元类中定义的方法对其创造的类是可见的。比如 C 是 A 的元类，C 中定义的类方法对 A 是可见的，A 可以调用来自 C 的类方法。

## 思考

把类对象思考成能够被实例公共访问的东西。实例对象想象成能够存在多份的东西。元类能够在类对象生成之前为其动态的创建一些方法和属性。
