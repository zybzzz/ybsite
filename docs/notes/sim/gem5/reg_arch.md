# gem5 reg arch

gem5 各个体系结构相关的寄存器的统一抽象，或者说是 gem5 的寄存器体系结构。

## 寄存器结构的抽象

`cpu/reg_class.hh` 下有最基本的有关于 cpu 使用到的寄存器的抽象。其中枚举了 `RegClassType` 这个类型。随后封装了一个接口类型的类，`RegClassOps`，里面包含了能够对寄存器进行的一些辅助操作。

随后进行了 `RegClass` 类的定义，这个类表示某一类寄存器，指定寄存器的类型，个数，每个寄存器的大小，但是不为寄存器分配具体的空间：

```cpp
class RegClass
{
  private:
    RegClassType _type; // 指向寄存器类型

    size_t _numRegs;    // 有几个这种类型的寄存器
    size_t _regBytes;   // 每个这种类型的寄存器的大小
    // This is how much to shift an index by to get an offset of a register in
    // a register file from the register index, which would otherwise need to
    // be calculated with a multiply.
    size_t _regShift;   // log2(寄存器大小)

    static inline RegClassOps defaultOps;
    RegClassOps *_ops = &defaultOps;    // 这种寄存器的辅助函数，这里指向默认的辅助函数
    const debug::Flag &debugFlag;
}
```

随后进行了 `RegId` 的定义，RegId 是对 RegClass 中的某一个具体寄存器进行名称的定义:

```cpp
class RegId
{
  protected:
    static const char* regClassStrings[];   // 名称，如 sp
    RegClassType regClass;  // 指向的 RegClass，比如 int
    RegIndex regIdx;        // 在所有同类型的寄存器中排名第几位
    int numPinnedWrites;

    friend struct std::hash<RegId>;
}
```

基于 `RegId` 继承出了 `PhysRegId` 用来表示物理寄存器的 id。

## 乱序处理器中实现的体系结构寄存器和物理寄存器

以 xiangshan 或者 o3 为例。在模拟器的乱序实现中，并没有真正的在物理上维护一个体系结构寄存器堆，而是在处理器每次提交的时候建立 (物理寄存器号->体系机构寄存器号之间的映射)，通过访问这个映射来实现对于体系结构寄存器的访问。因此在这里只关注物理寄存器的实现，主要关注 `cpu/o3/regfile` 这里的物理寄存器的实现。

在看 `cpu/o3/regfile` 之前需要看 `cpu/regfile`，`cpu/regfile` 实现了一个裸寄存器堆，简单的来讲，他就是对一篇内存空间进行了抽象，好让你对寄存器进行访问，可以通过 RegFile.reg(1) 对于某个类型寄存器中的第一个寄存器进行访问。在乱序处理器中的物理寄存器的实现也没什么奇怪的，无非就是使用了 `cpu/regfile` 中的裸寄存器堆为整数、浮点、向量的寄存器分配了位置：

```cpp
PhysRegFile::PhysRegFile(unsigned _numPhysicalIntRegs,
                         unsigned _numPhysicalFloatRegs,
                         unsigned _numPhysicalVecRegs,
                         unsigned _numPhysicalVecPredRegs,
                         unsigned _numPhysicalCCRegs,
                         unsigned _numPhysicalRMiscRegs,
                         const BaseISA::RegClasses &reg_classes)
    : intRegFile(reg_classes.at(IntRegClass), _numPhysicalIntRegs),
      floatRegFile(reg_classes.at(FloatRegClass), _numPhysicalFloatRegs),
      vectorRegFile(reg_classes.at(VecRegClass), _numPhysicalVecRegs),
      vectorElemRegFile(reg_classes.at(VecElemClass), _numPhysicalVecRegs * (
                  reg_classes.at(VecElemClass).numRegs() /
                  reg_classes.at(VecRegClass).numRegs())),
      vecPredRegFile(reg_classes.at(VecPredRegClass), _numPhysicalVecPredRegs),
      ccRegFile(reg_classes.at(CCRegClass), _numPhysicalCCRegs),
      rMiscRegFile(reg_classes.at(RMiscRegClass), _numPhysicalRMiscRegs),
      numPhysicalIntRegs(_numPhysicalIntRegs),
      numPhysicalFloatRegs(_numPhysicalFloatRegs),
      numPhysicalVecRegs(_numPhysicalVecRegs),
      numPhysicalVecElemRegs(_numPhysicalVecRegs * (
                  reg_classes.at(VecElemClass).numRegs() /
                  reg_classes.at(VecRegClass).numRegs())),
      numPhysicalVecPredRegs(_numPhysicalVecPredRegs),
      numPhysicalCCRegs(_numPhysicalCCRegs),
      numPhysicalRMiscRegs(_numPhysicalRMiscRegs),
      totalNumRegs(_numPhysicalIntRegs
                   + _numPhysicalFloatRegs
                   + _numPhysicalVecRegs
                   + numPhysicalVecElemRegs
                   + _numPhysicalVecPredRegs
                   + _numPhysicalCCRegs
                   + numPhysicalRMiscRegs)
{
    RegIndex phys_reg;
    RegIndex flat_reg_idx = 0;

    // The initial batch of registers are the integer ones
    for (phys_reg = 0; phys_reg < numPhysicalIntRegs; phys_reg++) {
        intRegIds.emplace_back(IntRegClass, phys_reg, flat_reg_idx++);
    }

    // The next batch of the registers are the floating-point physical
    // registers; put them onto the floating-point free list.
    for (phys_reg = 0; phys_reg < numPhysicalFloatRegs; phys_reg++) {
        floatRegIds.emplace_back(FloatRegClass, phys_reg, flat_reg_idx++);
    }

    // The next batch of the registers are the vector physical
    // registers; put them onto the vector free list.
    for (phys_reg = 0; phys_reg < numPhysicalVecRegs; phys_reg++) {
        vecRegIds.emplace_back(VecRegClass, phys_reg, flat_reg_idx++);
    }
    // The next batch of the registers are the vector element physical
    // registers; put them onto the vector free list.
    for (phys_reg = 0; phys_reg < numPhysicalVecElemRegs; phys_reg++) {
        vecElemIds.emplace_back(VecElemClass, phys_reg, flat_reg_idx++);
    }

    // The next batch of the registers are the predicate physical
    // registers; put them onto the predicate free list.
    for (phys_reg = 0; phys_reg < numPhysicalVecPredRegs; phys_reg++) {
        vecPredRegIds.emplace_back(VecPredRegClass, phys_reg, flat_reg_idx++);
    }

    // The rest of the registers are the condition-code physical
    // registers; put them onto the condition-code free list.
    for (phys_reg = 0; phys_reg < numPhysicalCCRegs; phys_reg++) {
        ccRegIds.emplace_back(CCRegClass, phys_reg, flat_reg_idx++);
    }

    // Renameable misc regs
    for (phys_reg = 0; phys_reg < numPhysicalRMiscRegs;
            phys_reg++) {
        rMiscRegIds.emplace_back(RMiscRegClass, phys_reg, flat_reg_idx++);
    }

    // Misc regs have a fixed mapping but still need PhysRegIds.
    for (phys_reg = 0; phys_reg < reg_classes.at(MiscRegClass).numRegs();
            phys_reg++) {
        miscRegIds.emplace_back(MiscRegClass, phys_reg, 0);
    }

    // must clear with zero
    rMiscRegFile.clear();
}

```

可以看到，这之中物理机寄存器堆中的数量完全就是用户指定的，并且所有的寄存器堆的种类中并不包括 invalid 的 reg。同时也可以看出，重命名的逻辑和寄存器的实现无关，完全是在 rename 中实现的。同时需要注意的是，上面的每个物理寄存器，都构造出了其在物理寄存器中的编号，还有全局的唯一编号。


## 向量体系结构

### 向量寄存器

由于各个体系结构的向量寄存器长度、特性等等是不同的，因此在 在 `arch/generic/vec_reg.hh` 下只封装出了向量寄存器中单个元素的抽象，也就是 `VecRegContainer`，他接受一个模板参数，代表单个元素的大小，这个元素的大小是以1字节（8位）为单位的。在注释中给出的示例是，如果想要封装一个 512 位的向量寄存器，可以使用 `using Vec512 = VecRegContainer<64>` 这样的方式来封装。如果想要封装运算操作，官方的示例如下：

```cpp
// Usage example, for a macro op:
VecFloat8Add(ExecContext* xd) {
   // Request source vector register to the execution context.
   Vec512 vsrc1raw;
   xc->getRegOperand(this, 0, &vsrc1raw);
   // View it as a vector of floats (we could just specify the first
   // template parametre, the second has a default value that works, and the
   // last one is derived by the constness of vsrc1raw).
   VecRegT<float, 8, true>& vsrc1 = vsrc1raw->as<float, 8>();
   // Second source and view
   Vec512 vsrc2raw;
   xc->getRegOperand(this, 1, &vsrc2raw);
   VecRegT<float, 8, true>& vsrc2 = vsrc2raw->as<float, 8>();
   // Destination and view
   Vec512 vdstraw;
   VecRegT<float, 8, false>& vdst = vdstraw->as<float, 8>();
   for (auto i = 0; i < 8; i++) {
       // This asignment sets the bits in the underlying Vec512: vdstraw
       vdst[i] = vsrc1[i] + vsrc2[i];
   }
   xc->setWriteRegOperand(this, 0, vdstraw); 
 
}

```

体系结构具体的向量寄存器实现实现在 `arch/riscv/reg` 下。

### 向量谓词寄存器

在 `arch/generic/vec_pred_reg.hh` 下。MVC 的架构实现，具体来讲就是内部用 `VecPredRegContainer` 存储实际的寄存器数据，外部通过 `VecPredRegT` 来封装接口，`VecPredRegT` 中封装了很多用来存储底层 `VecPredRegContainer` 的接口。包括存取数据、打印数据等等。

值得关心的有两点。其中一点是，谓词寄存器的使用，在谓词寄存器置 1 的时候表示相关的元素参与运算，当谓词寄存器置 0 的时候表示向量的相关元素不参与运算。二是 `VecPredRegT` 中的模板参数:

```cpp
template <typename VecElem, size_t NumElems, bool Packed, bool Const>
class VecPredRegT
{}
```

VecElem 表示向量寄存器中单个元素的类型；NumElems 表示元素的个数；Packed 表示每个谓词位的 0 和 1 代表的一个单位元素是否参与向量运算还是一个字节参与向量运算；const 表示底层的谓词数据是否可更改。

## 寄存器重命名

实现在 `cpu/o3/rename_map` 下，和之前的套路很像，先维护一个的那个类型的，再通过复制单个类型的组成多个类型的。

单个寄存器种类的寄存器映射在 SimpleRenameMap 中实现，其中一张 map 维护了单个种类的寄存器（整数、浮点等等）的实现。其初始化需要指定代表那种寄存器类型，还有指定这种具体类型寄存器堆的 freeList，renamemap 就从 list 中拿空想数据。比较重要的是其 rename 方法：

```cpp
SimpleRenameMap::RenameInfo
SimpleRenameMap::rename(const RegId &arch_reg,
                        const PhysRegIdPtr provided_dest)
{
    PhysRegIdPtr renamed_reg;
    // Record the current physical register that is renamed to the
    // requested architected register.
    PhysRegIdPtr prev_reg = map[arch_reg.index()];

    if (arch_reg.is(InvalidRegClass)) {
        assert(prev_reg->is(InvalidRegClass));
        renamed_reg = prev_reg;
    } else if (provided_dest != nullptr) {
        renamed_reg = provided_dest;
        if (prev_reg != provided_dest) {
            map[arch_reg.index()] = provided_dest;
            renamed_reg->incRef();
            DPRINTF(Rename, "Increment the ex ref of p%i to %i\n",
                    renamed_reg->flatIndex(), renamed_reg->getRef());
        } else {
            DPRINTF(Rename,
                    "Provided destination is the same as the previous one, "
                    "leave ref counter untouched\n");
        }
    } else if (prev_reg->getNumPinnedWrites() > 0) {
        // Do not rename if the register is pinned
        assert(arch_reg.getNumPinnedWrites() == 0);  // Prevent pinning the
                                                     // same register twice
        DPRINTF(Rename, "Renaming pinned reg, numPinnedWrites %d\n",
                prev_reg->getNumPinnedWrites());
        renamed_reg = prev_reg;
        renamed_reg->decrNumPinnedWrites();
    } else {
        renamed_reg = freeList->getReg();
        DPRINTF(Rename, "Get free reg p%i\n", renamed_reg->flatIndex());
        map[arch_reg.index()] = renamed_reg;
        renamed_reg->setNumPinnedWrites(arch_reg.getNumPinnedWrites());
        renamed_reg->setNumPinnedWritesToComplete(
            arch_reg.getNumPinnedWrites() + 1);
        DPRINTF(Rename, "Increment the ex ref of p%i to %i\n",
                renamed_reg->flatIndex(), renamed_reg->getRef());
    }

    DPRINTF(Rename, "Renamed reg %d to physical reg %d (%d) old mapping was"
            " %d (%d)\n",
            arch_reg, renamed_reg->flatIndex(), renamed_reg->flatIndex(),
            prev_reg->flatIndex(), prev_reg->flatIndex());

    return RenameInfo(renamed_reg, prev_reg);
}
```

简单的来说，如果之前就是 invalid 的 class 的寄存器，其重命名永远指向自己。如果用户传入寄存器，就是用用户的寄存器作为重命名寄存器。否则就从 freeList 拿出来一个作为重命名的寄存器。然后更新重命名的 map。

整个 UnifiedRenameMap,就是每个种类的寄存器分配一个 singlerenamemap。值得关注的点是其对 invalid 种类或者不能重命名种类的寄存器的处理。

```cpp
/**
    * Tell rename map to get a new free physical register to remap
    * the specified architectural register. This version takes a
    * RegId and reads the  appropriate class-specific rename table.
    * @param arch_reg The architectural register id to remap.
    * @return A RenameInfo pair indicating both the new and previous
    * physical registers.
    */
RenameInfo
rename(const RegId& dest_reg, const PhysRegIdPtr last_dest_phy)
{
    if (!dest_reg.isRenameable()) {
        // misc regs aren't really renamed, just remapped
        PhysRegIdPtr phys_reg = lookup(dest_reg);
        // Set the new register to the previous one to keep the same
        // mapping throughout the execution.
        return RenameInfo(phys_reg, phys_reg);
    }

    return renameMaps[dest_reg.classValue()].rename(dest_reg,
                                                    last_dest_phy);
}

/**
    * Look up the physical register mapped to an architectural register.
    * This version takes a flattened architectural register id
    * and calls the appropriate class-specific rename table.
    * @param arch_reg The architectural register to look up.
    * @return The physical register it is currently mapped to.
    */
PhysRegIdPtr
lookup(const RegId& arch_reg) const
{
    auto reg_class = arch_reg.classValue();
    if (reg_class == InvalidRegClass) {
        return &invalidPhysRegId;
    } else if (reg_class == MiscRegClass) {
        // misc regs aren't really renamed, they keep the same
        // mapping throughout the execution.
        return regFile->getMiscRegId(arch_reg.index());
    }
    return renameMaps[reg_class].lookup(arch_reg);
}
```

可以看到对不能重命名的寄存器直接返回其物理寄存器的 regid，没有任何的重命名过程，并且每次的重命名和前一次的重命名是相等的。等于说他们一直存储在那个位置上，不存在所谓的重命名。