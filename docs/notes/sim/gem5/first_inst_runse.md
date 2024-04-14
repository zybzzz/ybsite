# 在 SE 下第一条指令是怎么运行的

这篇文章的示例 python 脚本是 `configs/learning_gem5/part1/two_level.py`，这篇文章介绍在 SE 模式下，gem5 是怎么运行第一条指令的，更加详细的说 gem5 是怎么把取指这个事件放入到事件调度队列中的，并不介绍指令的具体执行过程。刚开始最天真的想法是在 cpu 构造函数被调用的时候会将第一次取指的请求放入到指令队列中，实际不是这样的，经过多次的 debug，在 cpu 进行初始化的时候并没有将取指这个事件放入到指令队列中，那这个取值的时间是谁插入队列就成为了一个谜，下逐步讲解这个过程。

这个过程涉及到的 python 脚本的代码如下：

```python
system.workload = SEWorkload.init_compatible(args.binary)

# Create a process for a simple "Hello World" application
process = Process()
# Set the command
# cmd is a list which begins with the executable (like argv)
process.cmd = [args.binary]
# Set the cpu to use the process as its workload and create thread contexts
system.cpu.workload = process
system.cpu.createThreads()

# set up the root SimObject and start the simulation
root = Root(full_system=False, system=system)
# instantiate all of the objects we've created above
m5.instantiate()
```

首先分析 `SEWorkload.init_compatible(args.binary)` 这句话，在进入到 `SEWorkload`（`src/sim/Workload.py`）的源代码中之后，可以看到其实现：

```python
class SEWorkload(Workload, metaclass=SEWorkloadMeta):
    type = "SEWorkload"
    cxx_header = "sim/se_workload.hh"
    cxx_class = "gem5::SEWorkload"
    abstract = True

    @classmethod
    def _is_compatible_with(cls, obj):
        return False

    @classmethod
    def find_compatible(cls, path):
        """List the SE workloads compatible with the binary at path"""

        from _m5 import object_file

        obj = object_file.create(path)
        options = list(
            filter(
                lambda wld: wld._is_compatible_with(obj),
                SEWorkloadMeta.all_se_workload_classes,
            )
        )

        return options

    @classmethod
    def init_compatible(cls, path, *args, **kwargs):
        """Construct the only SE workload compatible with the binary at path"""

        options = SEWorkload.find_compatible(path)

        if len(options) > 1:
            raise ValueError("More than one SE workload is compatible with %s")
        elif len(options) < 1:
            raise ValueError("No SE workload is compatible with %s", path)

        return options[0](*args, **kwargs)
```

首先这是一个抽象类，并且他有一个元类 `SEWorkloadMeta`，在看 `SEWorkloadMeta` 这个元类的代码：

```python
class SEWorkloadMeta(type(Workload)):
    all_se_workload_classes = []

    def __new__(mcls, name, bases, dct):
        cls = super().__new__(mcls, name, bases, dct)
        SEWorkloadMeta.all_se_workload_classes.append(cls)
        return cls
```

他只是将其拿到的 python 类对象存放到了一个列表中了而已，他拿到的类对象是将 `SEWorkloadMeta` 指定为元类的所有类对象。在 `configs/learning_gem5/part1/two_level.py` 中执行的是 `SEWorkload.init_compatible(args.binary)`，看看这个函数，可以看到在它的执行过程中调用了 `SEWorkload.find_compatible(path)`，再看这个函数，其首先进行的操作是 `obj = object_file.create(path)`，这个函数是 pybind 实现的，查看其 pybind 的相关实现：

```cpp
void
objectfile_pybind(py::module_ &m_internal)
{
    py::module_ m = m_internal.def_submodule("object_file");

    py::class_<loader::ObjectFile>(m, "ObjectFile")
        .def("get_arch", [](const loader::ObjectFile &obj) {
                return loader::archToString(obj.getArch());
                }, py::return_value_policy::reference)
        .def("get_op_sys", [](const loader::ObjectFile &obj) {
                return loader::opSysToString(obj.getOpSys());
                }, py::return_value_policy::reference)
        .def("entry_point", &loader::ObjectFile::entryPoint)
        .def("get_interpreter", &loader::ObjectFile::getInterpreter);

    m.def("create", [](const std::string &fname) {
            return loader::createObjectFile(fname); });
}
```

可以看到这个函数的本质是调用了 `loader::createObjectFile(fname)` 方法，这个方法定义在 `src/base/loader/object_file.cc` 文件中，查看其源代码：

```cpp
ObjectFile *
createObjectFile(const std::string &fname, bool raw)
{
    ImageFileDataPtr ifd(new ImageFileData(fname));

    for (auto &format: object_file_formats()) {
        ObjectFile *file_obj = format->load(ifd);
        if (file_obj)
            return file_obj;
    }

    if (raw)
        return new RawImage(ifd);

    return nullptr;
}
```

可以看到其首先根据传入的二进制可执行文件的路径，创建出 `ImageFileData` 对象，查看源代码能够发现，这个对象包含了这个可执行文件最基本的信息。随后其对 `object_file_formats` 这个函数的返回结果进行遍历，进行相关的条件判断，查看 `object_file_formats` 的源代码：

```cpp
namespace
{

typedef std::vector<ObjectFileFormat *> ObjectFileFormatList;

ObjectFileFormatList &
object_file_formats()
{
    static ObjectFileFormatList formats;
    return formats;
}

} // anonymous namespace
```

可以看到返回的实际上就是 `formats` 这个向量，但是这个向量中的元素不会凭空出现，肯定在之前有方法向其中插入了元素，就在这部分源代码的后面，有向这个列表中插入元素的源代码：

```cpp
ObjectFileFormat::ObjectFileFormat()
{
    object_file_formats().emplace_back(this);
}
```

可以看到只要是 `ObjectFileFormat` 类的对象和其子对象在进行构造的时候，其就会被插入到这个向量中，`ObjectFileFormat` 这个类本身是一个抽象类，是不能被创建出具体对象的，因此只需要找到其子类就行了，根据查询 doxygen 文档，发现其只有一个子类 `ElfObjectFormat`（`src/base/loader/elf_object.hh`）这也是从侧面证明 gem5 只能 load elf 格式的文件？话说回来，这个类的对象是什么时候被创建的呢，为什么调用 `object_file_formats` 这个方法的时候他就已经在向量中的了呢？在 `src/base/loader/elf_object.cc` 中可以看到：

```cpp
namespace
{

ElfObjectFormat elfObjectFormat;
std::string interpDir;

} // anonymous namespace
```

在匿名的名称空间中有一个这个类的全局变量对象，也就是说在程序运行的开始，这个 `elfObjectFormat` 对象就被插入到向量中了。再回到对 `object_file_formats` 的遍历，由于传入的也是一个 elf 形式的可执行文件，因此这个 `ObjectFile *file_obj = format->load(ifd);` 是能够成功执行的。于是 `ObjectFile` 被返回。再回到 python 代码：

```cpp
options = list(
    filter(
        lambda wld: wld._is_compatible_with(obj),
        SEWorkloadMeta.all_se_workload_classes,
    )
)

return options
```

这里实际上是进行一种对 `all_se_workload_classes` 的过滤工作，其是想测试对于刚刚拿到的 elf object，测试有哪些 `se_workload_classes` 能够对其进行处理，问题又来了，到底是什么时候 `all_se_workload_classes` 中被填充了数据，只有将 `SEWorkloadMeta` 设置为元类的类才能将自己的类对象添加到 `all_se_workload_classes` 中。通过全局的查找发现，每种体系结构都会实现自己的 `se_workload_classes` 并且会用 `_is_compatible_with` 对是否兼容传入的 obj 对象进行判断，比如 X86 架构，有其实现：

```python
class X86EmuLinux(SEWorkload):
    type = "X86EmuLinux"
    cxx_header = "arch/x86/linux/se_workload.hh"
    cxx_class = "gem5::X86ISA::EmuLinux"

    @classmethod
    def _is_compatible_with(cls, obj):
        return obj.get_arch() in ("x86_64", "i386") and obj.get_op_sys() in (
            "linux",
            "unknown",
        )

```

由此以来，我们可以肯定 `init_compatible` 返回的就是这个类的一个实例。

回到 `configs/learning_gem5/part1/two_level.py` 中对于 `Process` 的创建 `process = Process()` 根据[这篇文章](./simobj_creation.md)的分析返回的是一个 `X86_64Process`（`src/arch/x86/process.hh`），这点非常重要。

随后就是 `m5.instantiate()`，在这个方法中有一段代码：

```python
# Restore checkpoint (if any)
if ckpt_dir:
    _drain_manager.preCheckpointRestore()
    ckpt = _m5.core.getCheckpoint(ckpt_dir)
    for obj in root.descendants():
        obj.loadState(ckpt)
else:
    for obj in root.descendants():
        obj.initState()
```

`ckpt_dir` 是检查设置的 checkpoint 的设置的，用于恢复状态或者设置初始状态，在 SE 模式下并不存在 checkpoint，因此所有 Simobject 的 `initState` 被调用用来状态的初始化，正是在这个 `initState` 的调用中，完成了将取值操作插入到队列中。

在 `X86_64Process` 的 `initState` 中，调用了 `X86Process::initState()`，这个函数实际上调用的是 `Process::initState()`：

```cpp
void
Process::initState()
{
    if (contextIds.empty())
        fatal("Process %s is not associated with any HW contexts!\n", name());

    // first thread context for this process... initialize & enable
    ThreadContext *tc = system->threads[contextIds[0]];

    // mark this context as active so it will start ticking.
    tc->activate();

    pTable->initState();

    initVirtMem.reset(new SETranslatingPortProxy(
                tc, SETranslatingPortProxy::Always));

    // load object file into target memory
    image.write(*initVirtMem);
    interpImage.write(*initVirtMem);
}
```

其中在指定 `TimingSimpleCPU` 的情况下，`ThreadContext` 会被指定为 `SimpleThread`，因此继续追踪 `SimpleThread` 的代码：

```cpp
void
SimpleThread::activate()
{
    if (status() == ThreadContext::Active)
        return;

    lastActivate = curTick();
    _status = ThreadContext::Active;
    baseCpu->activateContext(_threadId);
}
```

其中有一行 `baseCpu->activateContext(_threadId);`，追踪这行的代码，在 BaseCPU 中：

```cpp
void
TimingSimpleCPU::activateContext(ThreadID thread_num)
{
    DPRINTF(SimpleCPU, "ActivateContext %d\n", thread_num);

    assert(thread_num < numThreads);

    threadInfo[thread_num]->execContextStats.notIdleFraction = 1;
    if (_status == BaseSimpleCPU::Idle)
        _status = BaseSimpleCPU::Running;

    // kick things off by initiating the fetch of the next instruction
    if (!fetchEvent.scheduled())
        schedule(fetchEvent, clockEdge(Cycles(0)));

    if (std::find(activeThreads.begin(), activeThreads.end(), thread_num)
         == activeThreads.end()) {
        activeThreads.push_back(thread_num);
    }

    BaseCPU::activateContext(thread_num);
}
```

可以清除的看到这边的代码中检测取指这个事件有没有放入到调度队列中，如果没有则插入到调度队列，由于这是程序的刚开始，所以被插入到调度队列中，至此对于 SE 模式下的第一条指令的取指如何进入到调度队列中已经记录完毕。