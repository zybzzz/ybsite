# pcstate.hh 代码解析

pcstate 这一系列的文件中定义的都是与当前 pc 值相关的一些类，用来封装 pc 的状态。

首先看：

```cpp
class PCStateBase : public Serializable
{
  protected:
    Addr _pc = 0;
    MicroPC _upc = 0;

    PCStateBase(const PCStateBase &other) : _pc(other._pc), _upc(other._upc) {}
    PCStateBase &operator=(const PCStateBase &other) = default;
    PCStateBase() {}

  public:
    virtual ~PCStateBase() = default;

    template<class Target>
    Target &
    as()
    {
        return static_cast<Target &>(*this);
    }

    template<class Target>
    const Target &
    as() const
    {
        return static_cast<const Target &>(*this);
    }

    virtual PCStateBase *clone() const = 0;
    virtual void
    update(const PCStateBase &other)
    {
        _pc = other._pc;
        _upc = other._upc;
    }
    void update(const PCStateBase *ptr) { update(*ptr); }

    virtual void output(std::ostream &os) const = 0;

    virtual bool
    equals(const PCStateBase &other) const
    {
        return _pc == other._pc && _upc == other._upc;
    }
    // ...
}
```

首先这个类维护的就是两个状态，pc 值和 upc 的值，分别对应的是指令计数器的值和微指令计数器的值。后定义了多个 `as` 函数，用于执行到某种目标类型的强制转换。后接着声明了 `clone` 和 `output` 纯虚函数留给子类去实现。

```cpp
//Class
{
    /**
     * Returns the memory address of the instruction this PC points to.
     *
     * @return Memory address of the instruction this PC points to.
     */
    Addr
    instAddr() const
    {
        return _pc;
    }

    /**
     * Returns the current micropc.
     *
     * @return The current micropc.
     */
    MicroPC
    microPC() const
    {
        return _upc;
    }

    virtual void
    uReset()
    {
        _upc = 0;
    }

    virtual void
    set(Addr val)
    {
        _pc = val;
        _upc = 0;
    }

    virtual void advance() = 0;
    virtual bool branching() const = 0;

    void
    serialize(CheckpointOut &cp) const override
    {
        SERIALIZE_SCALAR(_pc);
        SERIALIZE_SCALAR(_upc);
    }

    void
    unserialize(CheckpointIn &cp) override
    {
        UNSERIALIZE_SCALAR(_pc);
        UNSERIALIZE_SCALAR(_upc);
    }
}

static inline std::ostream &
operator<<(std::ostream & os, const PCStateBase &pc)
{
    pc.output(os);
    return os;
}

static inline bool
operator==(const PCStateBase &a, const PCStateBase &b)
{
    return a.equals(b);
}

static inline bool
operator!=(const PCStateBase &a, const PCStateBase &b)
{
    return !a.equals(b);
}

```

剩下这部分简单的重载了几个比较的时候使用的运算符，定义了纯虚函数 `advance` 和 `branching` 留给子类去实现，`advance` 用来表示下一条指令的 pc 情况，可能是正常的往下执行或者分支。`branching` 则用来判断是不是分支。

```cpp
namespace
{

inline void
set(PCStateBase *&dest, const PCStateBase *src)
{
    if (GEM5_LIKELY(dest)) {
        if (GEM5_LIKELY(src)) {
            // Both src and dest already have storage, so just copy contents.
            dest->update(src);
        } else {
            // src is empty, so clear out dest.
            dest = nullptr;
        }
    } else {
        if (GEM5_LIKELY(src)) {
            // dest doesn't have storage, so create some as a copy of src.
            dest = src->clone();
        } else {
            // dest is already nullptr, so nothing to do.
        }
    }
}

inline void
set(std::unique_ptr<PCStateBase> &dest, const PCStateBase *src)
{
    PCStateBase *dest_ptr = dest.get();
    set(dest_ptr, src);
    if (dest.get() != dest_ptr)
        dest.reset(dest_ptr);
}

// other set methods

}
```

后续在文件的匿名内部空间中定义了多种类型的 `set` 函数，`set` 函数的主要作用是将 src 的数据更新到 dest，同时将函数定义在匿名的空间内，限制了可见性在本文件中。

后续定义了 `PCStateWithNext`：

```cpp
class PCStateWithNext : public PCStateBase
{
  protected:
    Addr _npc = 0;

    MicroPC _nupc = 1;

    PCStateWithNext(const PCStateWithNext &other) : PCStateBase(other),
        _npc(other._npc), _nupc(other._nupc)
    {}
    PCStateWithNext &operator=(const PCStateWithNext &other) = default;
    PCStateWithNext() {}

    // ... 
}
```

这个类只是为 `PCStateBase` 附加上了下一条执行指令的 `pc` 信息。这个类中 `advance` 的实现只是简单的向下执行指令。判断是否是一次分支的方法是下一个地址是不是 `pc + instwidth`。

后续对于这个简单的 `SimplePCState` 实现进行了拓展，实现了 `UPCState`。用于处理微指令计数器的相关情况。
