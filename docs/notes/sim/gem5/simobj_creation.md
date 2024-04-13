# gem5 SimObject 创建过程

gem5 中 SimObject 的创建过程如果简单的来讲就是 `src/python/m5/simulate.py` 中的一句 `m5.instantiate()`，这个方法完成了 SimObject 的创建并且进行了端口的初始化。原先想的是创建对象的过程很简单，肯定是在这个方法的执行过程中进行了 cpp 的代码的 new 操作，然后创建出的对象，实际不然，创建的过程远比想象的复杂。

## 创建过程

进入到 `m5.instantiate()` 中，可以看到：

```python
    # Create the C++ sim objects and connect ports
    for obj in root.descendants():
        obj.createCCObject()
    for obj in root.descendants():
        obj.connectPorts()
```

这个方法中的这部分代码用于创建 SimObject 并连接端口，再继续往下跟踪代码，进入到 `obj.createCCObject()` 中：

```python

    def createCCObject(self):
        if self.abstract:
            fatal(f"Cannot instantiate an abstract SimObject ({self.path()})")
        self.getCCParams()
        self.getCCObject()  # force creation

```

这个函数的定义如上，可以看到先是进行了是否是抽象类的检查，如果不是抽象类才能继续往下创建。在通过抽象类的检查之后，先是进行 Params 文件（就是实现python 和 cpp 参数绑定文件）的创建，然后再创建具体的 SimObject。再通过 `self.getCCObject()` 向下跟踪：

```python

    def getCCObject(self):
        if not self._ccObject:
            # Make sure this object is in the configuration hierarchy
            if not self._parent and not isRoot(self):
                raise RuntimeError("Attempt to instantiate orphan node")
            # Cycles in the configuration hierarchy are not supported. This
            # will catch the resulting recursion and stop.
            self._ccObject = -1
            if not self.abstract:
                params = self.getCCParams()
                self._ccObject = params.create()
        elif self._ccObject == -1:
            raise RuntimeError(
                f"{self.path()}: Cycle found in configuration hierarchy."
            )
        return self._ccObject

```

可以看到创建 SimObject 最为关键的一步是调用 `self._ccObject = params.create()`，即通过定义的 Params 类中的 create 方法将 SimObject 创建出来，而不是简简单单的去 new。

通过翻阅各个 Params 头文件中的类，以 `build/X86/params/BaseTimingSimpleCPU.hh` 为例：

```cpp
namespace gem5
{
struct BaseTimingSimpleCPUParams
    : public BaseSimpleCPUParams
{
    gem5::TimingSimpleCPU * create() const;
};

} // namespace gem5
```

自动生成的 Params 类中确实声明了 `create` 方法。但是问题又来了，这个方法的实现在哪里？很天然的想到方法的实现可能也放在与 Params 相关的自动生成的文件中，与 Params 相关的自动生成的文件还存在于 `build/X86/python/_m5` 下，这是这个目录下的各个文件实现了动态绑定。我们选取之前与 `build/X86/params/BaseTimingSimpleCPU.hh` 对应的 `build/X86/python/_m5/param_BaseTimingSimpleCPU.cc` 来进行分析：

```cpp
namespace py = pybind11;

namespace gem5
{

static void
module_init(py::module_ &m_internal)
{
py::module_ m = m_internal.def_submodule("param_BaseTimingSimpleCPU");
    py::class_<BaseTimingSimpleCPUParams, BaseSimpleCPUParams, std::unique_ptr<BaseTimingSimpleCPUParams, py::nodelete>>(m, "BaseTimingSimpleCPUParams")
        .def(py::init<>())
        .def("create", &BaseTimingSimpleCPUParams::create)
        ;

    py::class_<gem5::TimingSimpleCPU, gem5::BaseSimpleCPU, std::unique_ptr<gem5::TimingSimpleCPU, py::nodelete>>(m, "gem5_COLONS_TimingSimpleCPU")
        ;

}

static EmbeddedPyBind embed_obj("BaseTimingSimpleCPU", module_init, "BaseSimpleCPU");

} // namespace gem5
```

这部分列举出的代码是实现动态绑定的。

```cpp
namespace
{

class DummyBaseTimingSimpleCPUParamsClass
{
  public:
    gem5::TimingSimpleCPU *create() const;
};

template <class CxxClass, class Enable=void>
class DummyBaseTimingSimpleCPUShunt;

template <class CxxClass>
class DummyBaseTimingSimpleCPUShunt<CxxClass, std::enable_if_t<
    std::is_constructible_v<CxxClass, const BaseTimingSimpleCPUParams &>>>
{
  public:
    using Params = BaseTimingSimpleCPUParams;
    static gem5::TimingSimpleCPU *
    create(const Params &p)
    {
        return new CxxClass(p);
    }
};

template <class CxxClass>
class DummyBaseTimingSimpleCPUShunt<CxxClass, std::enable_if_t<
    !std::is_constructible_v<CxxClass, const BaseTimingSimpleCPUParams &>>>
{
  public:
    using Params = DummyBaseTimingSimpleCPUParamsClass;
    static gem5::TimingSimpleCPU *
    create(const Params &p)
    {
        return nullptr;
    }
};

} // anonymous namespace

[[maybe_unused]] gem5::TimingSimpleCPU *
DummyBaseTimingSimpleCPUShunt<gem5::TimingSimpleCPU>::Params::create() const
{
    return DummyBaseTimingSimpleCPUShunt<gem5::TimingSimpleCPU>::create(*this);
}
```

首先定义了 `DummyBaseTimingSimpleCPUParamsClass` 类，这个类中也包含了 `create` 方法。随后声明了一个模板 `DummyBaseTimingSimpleCPUShunt`，这个模板中有一个 `class Enable` 参数可以用来指定条件编译，即在 `class Enable` 为true或者false的情况下编译出不同的版本。

对于 Enable 的判断结果来自 `std::enable_if_t<std::is_constructible_v<CxxClass, const BaseTimingSimpleCPUParams &>>`，简单的来说，就是如果 `CxxClass` 这个模板参数的构造函数中只接受 `const BaseTimingSimpleCPUParams &` 作为构造函数，那就返回 true， 否则返回false。对于返回为 true 的情况，模板类中的 create 方法返回一个 CxxClass 的对象；对于返回 false 的情况， create 方法返回 null。

最为关键的是最后一部分，正是最后一部分实现了自动生成的 `BaseTimingSimpleCPUParams` 类的 create 方法实现。可以看到最后一部分定义了 `DummyBaseTimingSimpleCPUShunt<gem5::TimingSimpleCPU>::Params::create()` 方法，在 Enable 返回 true 的时候，`DummyBaseTimingSimpleCPUShunt<gem5::TimingSimpleCPU>::Params` 刚好是 `BaseTimingSimpleCPUParams`，也就是说在定义 `BaseTimingSimpleCPU` 这个 SimObject 的时候如果存在一个只接受 `const BaseTimingSimpleCPUParams &` 的方法，在创建对象的时候会调用这个方法。如果Enable 返回了 false，最后一部分定义的是 `DummyBaseTimingSimpleCPUParamsClass` 的 create 方法，实际上等于什么都没做，如果你在定义某个 SimObject 的时候使用了不同形式的构造方法导致了 Enable 返回了 false，那么在创建 SimObject 对象的时候应该不会被创建，而是应该会报出 create 方法未实现这样的错误。

这实际上需要你自己去实现这个 create 方法，这可能是 gem5 留的一个后门，可能也是灵活性的一种体现。举例来说，`src/sim/process.hh` 就是一个使Enable 返回 false 的 SimObject，但是其在 `src/sim/process.cc` 的最后，有如下代码：

```cpp
Process *
ProcessParams::create() const
{
    // If not specified, set the executable parameter equal to the
    // simulated system's zeroth command line parameter
    const std::string &exec = (executable == "") ? cmd[0] : executable;

    auto *obj_file = loader::createObjectFile(exec);
    fatal_if(!obj_file, "Cannot load object file %s.", exec);

    Process *process = Process::tryLoaders(*this, obj_file);
    fatal_if(!process, "Unknown error creating process object.");

    return process;
}
```

等于自己补充实现了 create 方法，辅助创建了 Simobject。

以上就是 SimObject 创建过程的解析。
