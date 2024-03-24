# reg_class.hh 详解

这里主要理解 reg_class 文件下的一堆定义。

在这个文件的开头，就定义了有关寄存器种类的枚举，将所有的寄存器种类分为整数寄存器、浮点寄存器等等，并且为每个种类分配代表其类型的字符串。随后给出了 `RegId` 的定义：

```cpp
class RegId
{
  protected:
    const RegClass *_regClass = nullptr;
    RegIndex regIdx;
    int numPinnedWrites;

    friend struct std::hash<RegId>;
    friend class RegClassIterator;

  public:
    inline constexpr RegId();

    constexpr RegId(const RegClass &reg_class, RegIndex reg_idx)
        : _regClass(&reg_class), regIdx(reg_idx), numPinnedWrites(0)
    {}

    constexpr operator RegIndex() const
    {
        return index();
    }
    // ... 
}
```

从这部分中可以看到，gem5 试图将不同体系结构中不同的寄存器名称转换为 (_regClass, regIdx) 的形式，这种形式能够防止一些冲突。同时设置 `numPinnedWrites` 变量，这个变量主要记录一个叫“固定写入”的概念，这个概念和寄存器重写有关。随后就是一些很常规的构造函数的定义。

```cpp
// class RegId
{
    constexpr bool
    operator==(const RegId& that) const
    {
        return classValue() == that.classValue() && regIdx == that.index();
    }

    constexpr bool
    operator!=(const RegId& that) const
    {
        return !(*this==that);
    }

    /** Order operator.
     * The order is required to implement maps with key type RegId
     */
    constexpr bool
    operator<(const RegId& that) const
    {
        return classValue() < that.classValue() ||
            (classValue() == that.classValue() && (regIdx < that.index()));
    }

    /**
     * Return true if this register can be renamed
     */
    constexpr bool
    isRenameable() const
    {
        return classValue() != MiscRegClass && classValue() != InvalidRegClass;
    }
}
```

随后重载了三种类型的运算符，主要在比较是否相等和顺序上。随后进行能够寄存器重写的判断，最后显示除了 `MiscRegClass` 这类寄存器之外，都能够进行寄存器的重写。

```cpp
// class RegId
{
    /** @return true if it is of the specified class. */
    inline constexpr bool is(RegClassType reg_class) const;

    /** Index accessors */
    /** @{ */
    constexpr RegIndex index() const { return regIdx; }

    /** Class accessor */
    constexpr const RegClass &regClass() const { return *_regClass; }
    inline constexpr RegClassType classValue() const;
    /** Return a const char* with the register class name. */
    inline constexpr const char* className() const;

    inline constexpr bool isFlat() const;
    inline RegId flatten(const BaseISA &isa) const;

    int getNumPinnedWrites() const { return numPinnedWrites; }
    void setNumPinnedWrites(int num_writes) { numPinnedWrites = num_writes; }

    friend inline std::ostream& operator<<(std::ostream& os, const RegId& rid);
};
```

随后的代码都是简单的获取一些信息。

随后定义了 `RegClassOps` 这个类：

```cpp
class RegClassOps
{
  public:
    /** Print the name of the register specified in id. */
    virtual std::string regName(const RegId &id) const;
    /** Print the value of a register pointed to by val of size size. */
    virtual std::string valString(const void *val, size_t size) const;
    /** Flatten register id id using information in the ISA object isa. */
    virtual RegId
    flatten(const BaseISA &isa, const RegId &id) const
    {
        return id;
    }
};
```

这个类很像是一个工具类，封装了特定寄存器能够执行的操作。其中能通过 `valString` 来访问寄存器的值。

然后定义了 `RegClass`：

```cpp
class RegClass
{
  private:
    RegClassType _type;
    const char *_name;

    size_t _numRegs;
    size_t _regBytes = sizeof(RegVal);
    // This is how much to shift an index by to get an offset of a register in
    // a register file from the register index, which would otherwise need to
    // be calculated with a multiply.
    size_t _regShift = ceilLog2(sizeof(RegVal));

    static inline RegClassOps defaultOps;
    const RegClassOps *_ops = &defaultOps;
    const debug::Flag &debugFlag;

    bool _flat = true;
}
```

`RegClass` 类主要用来抽象某一种类型的寄存器。`_type` 指定了代表的寄存器类型，`_name` 同理。`_numRegs` 指定了这一类型寄存器的数目。`_regBytes` 指定了单个寄存器的大小。`_regShift` 表示存储寄存器数值中的低几位是没用的，以 64 位寄存器为例，其存储地址的低3位是没有用的，可以通过右移三位能够快速获得寄存器的index。随后定义了静态的 `RegClassOps`，作为这种寄存器类的默认帮助类。设置`_flat` 为 true，这个和寄存器折叠有关系。

```cpp
//class RegClass
{
    constexpr RegClass(RegClassType type, const char *new_name,
            size_t num_regs, const debug::Flag &debug_flag) :
        _type(type), _name(new_name), _numRegs(num_regs), debugFlag(debug_flag)
    {}

    constexpr RegClass
    needsFlattening() const
    {
        RegClass reg_class = *this;
        reg_class._flat = false;
        return reg_class;
    }

    constexpr RegClass
    ops(const RegClassOps &new_ops) const
    {
        RegClass reg_class = *this;
        reg_class._ops = &new_ops;
        return reg_class;
    }

    template <class RegType>
    constexpr RegClass
    regType() const
    {
        RegClass reg_class = *this;
        reg_class._regBytes = sizeof(RegType);
        reg_class._regShift = ceilLog2(reg_class._regBytes);
        return reg_class;
    }
}
```

随后定义了构造函数和三种方法，这三种方法更像是从某一个 `RegClass` 对象中，以其为模板，创造出新的 `RegClass` 对象。

```cpp
{
constexpr RegClassType type() const { return _type; }
    constexpr const char *name() const { return _name; }
    constexpr size_t numRegs() const { return _numRegs; }
    constexpr size_t regBytes() const { return _regBytes; }
    constexpr size_t regShift() const { return _regShift; }
    constexpr const debug::Flag &debug() const { return debugFlag; }
    constexpr bool isFlat() const { return _flat; }

    std::string regName(const RegId &id) const { return _ops->regName(id); }
    std::string
    valString(const void *val) const
    {
        return _ops->valString(val, regBytes());
    }
    RegId
    flatten(const BaseISA &isa, const RegId &id) const
    {
        return isFlat() ? id : _ops->flatten(isa, id);
    }

    using iterator = RegClassIterator;

    inline iterator begin() const;
    inline iterator end() const;

    inline constexpr RegId operator[](RegIndex idx) const;
};
```

随后都是一些获取信息的方法，包括获取迭代器的方法。

随后定义了迭代器，定义了两个不同的`RegClassOps`。还同`RegId`相似，定义了物理寄存器的`PhysRegId`。
