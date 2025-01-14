# macroinst 和 microinst

macroinst 和 microinst 都继承自 riscv staticinst，macroinst 表示一个 microinst 组，等于用一堆小指令组成一个大的指令。riscv 中 ll,sc atomic 指令都会使用到这个。对于 macroinst 会设置 ismicro 标志，对于 micro 会设置 micro 标识。从 macro 中取 micro 就是按照数组下标访问一个 micro。

对于 micro 的增长：

```cpp
void
RiscvMicroInst::advancePC(PCStateBase &pcState) const
{
    auto &rpc = pcState.as<PCState>();
    if (flags[IsLastMicroop]) {
        rpc.uEnd();
    } else {
        rpc.uAdvance();
    }
}
```

应该是没读完就读数组里的下一个，读完了就跳到下一个 pc，也就是程序意义上的下一条指令。

## riscv 指令 pc 结构

```cpp
class PCState : public GenericISA::UPCState<4>
{
  private:
    bool _compressed = false;
    bool _rv32 = false;

  public:
    using GenericISA::UPCState<4>::UPCState;

    PCStateBase *clone() const override { return new PCState(*this); }

    void
    update(const PCStateBase &other) override
    {
        Base::update(other);
        auto &pcstate = other.as<PCState>();
        _compressed = pcstate._compressed;
        _rv32 = pcstate._rv32;
    }

    void compressed(bool c) { _compressed = c; }
    bool compressed() const { return _compressed; }

    void rv32(bool val) { _rv32 = val; }
    bool rv32() const { return _rv32; }

    bool
    start_equals(const PCStateBase &other) const
    {
        return PCStateBase::equals(other);
    }

    bool
    branching() const override
    {
        if (_compressed) {
            return npc() != pc() + 2 || nupc() != upc() + 1;
        } else {
            return npc() != pc() + 4 || nupc() != upc() + 1;
        }
    }

    Addr
    getFallThruPC() const override
    {
        return pc() + (compressed() ? 2 : 4);
    }
};

```

主要记录了指令是不是压缩指令和 risc32 指令。branch 表示这个指令是不是分支，getFallThruPC 表示指令增长的下一个地址。

##

```cpp
template <int InstWidth>
class UPCState : public SimplePCState<InstWidth>
{
  protected:
    typedef SimplePCState<InstWidth> Base;

  public:
    void
    output(std::ostream &os) const override
    {
        Base::output(os);
        ccprintf(os, ".(%d=>%d)", this->upc(), this->nupc());
    }

    PCStateBase *
    clone() const override
    {
        return new UPCState<InstWidth>(*this);
    }

    void
    set(Addr val)
    {
        Base::set(val);
        this->upc(0);
        this->nupc(1);
    }

    UPCState(const UPCState &other) : Base(other) {}
    UPCState &operator=(const UPCState &other) = default;
    UPCState() {}
    explicit UPCState(Addr val) { set(val); }

    bool
    branching() const override
    {
        return this->npc() != this->pc() + InstWidth ||
               this->nupc() != this->upc() + 1;
    }

    // Advance the upc within the instruction.
    void
    uAdvance()
    {
        this->upc(this->nupc());
        this->nupc(this->nupc() + 1);
    }

    // End the macroop by resetting the upc and advancing the regular pc.
    void
    uEnd()
    {
        this->advance();
        this->upc(0);
        this->nupc(1);
    }
};

```

只关注 uend 和 uAdvance 实际上就是没到底的 upc + 1，到底的跳转到下一条广义指令上。

## 最简单的 pcstatebase

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

    virtual Addr
    getFallThruPC() const
    {
        return _pc + 4;
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
};

```

uReset 设置 upc 为 0.microPC 返回 upc。instAddr 返回 pc。


## PCStateWithNext

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

  public:
    Addr pc() const { return _pc; }
    void pc(Addr val) { _pc = val; }

    Addr npc() const { return _npc; }
    void npc(Addr val) { _npc = val; }

    MicroPC upc() const { return _upc; }
    void upc(MicroPC val) { _upc = val; }

    MicroPC nupc() const { return _nupc; }
    void nupc(MicroPC val) { _nupc = val; }

    // Reset the macroop's upc without advancing the regular pc.
    void
    uReset() override
    {
        PCStateBase::uReset();
        _nupc = 1;
    }

    void
    setNPC(Addr val)
    {
        npc(val);
    }

    void
    output(std::ostream &os) const override
    {
        ccprintf(os, "(%#x=>%#x)", this->pc(), this->npc());
    }

    void
    update(const PCStateBase &other) override
    {
        PCStateBase::update(other);
        auto &pcstate = other.as<PCStateWithNext>();
        _npc = pcstate._npc;
        _nupc = pcstate._nupc;
    }

    bool
    equals(const PCStateBase &other) const override
    {
        auto &ps = other.as<PCStateWithNext>();
        return PCStateBase::equals(other) &&
            _npc == ps._npc && _nupc == ps._nupc;
    }

    void
    serialize(CheckpointOut &cp) const override
    {
        PCStateBase::serialize(cp);
        SERIALIZE_SCALAR(_npc);
        SERIALIZE_SCALAR(_nupc);
    }

    void
    unserialize(CheckpointIn &cp) override
    {
        PCStateBase::unserialize(cp);
        UNSERIALIZE_SCALAR(_npc);
        UNSERIALIZE_SCALAR(_nupc);
    }
};

```

PCStateWithNext 等于形成了一个当前指令和下一条指令的组合，实际上是 (pc,upc)(npc, nupc) 的组合。

## set 模板函数

全是进行深拷贝。

## pcstate 的 set reset 

好像都是将数值设置成当前的 pc，下一个设置成自增的。

## static inst advance pc

调用 riscv staticinst 的 advance，实际上就是将 (pc, upc1, npc, nupc1) -> (npc ,upc1, npc + inst width, nupc1) 实际上就是只对 pc 进行转变，对 npc 无变化。

## 典型的 macro 组成

```cpp
    Sc_w::Sc_w(ExtMachInst machInst):
        StoreCond("sc_w", machInst, IntAluOp)
    {
        ;

        StaticInstPtr rel_fence;
        StaticInstPtr lrsc;
        StaticInstPtr acq_fence;

        // set up release fence
        if (RL) {
            rel_fence = new MemFenceMicro(machInst, No_OpClass);
            rel_fence->setFlag(IsFirstMicroop);
            rel_fence->setFlag(IsReadBarrier);
            rel_fence->setFlag(IsWriteBarrier);
            rel_fence->setFlag(IsDelayedCommit);
        }

        // set up atomic rmw op
        lrsc = new Sc_wMicro(machInst, this);

        if (!RL) {
            lrsc->setFlag(IsFirstMicroop);
        }

        if (!AQ) {
            lrsc->setFlag(IsLastMicroop);
        } else {
            lrsc->setFlag(IsDelayedCommit);
        }

        // set up acquire fence
        if (AQ) {
            acq_fence = new MemFenceMicro(machInst, No_OpClass);
            acq_fence->setFlag(IsLastMicroop);
            acq_fence->setFlag(IsReadBarrier);
            acq_fence->setFlag(IsWriteBarrier);
        }

        if (RL && AQ) {
            microops = {rel_fence, lrsc, acq_fence};
        } else if (RL) {
            microops = {rel_fence, lrsc};
        } else if (AQ) {
            microops = {lrsc, acq_fence};
        } else {
            microops = {lrsc};
        }
    }

```

可以看到在译码的时候将三个小指令组成一个大指令，并指定开始和结束。

## macro 的执行

应该是直接拆成三个小的执行。他自己应该是没有执行方法。

## delay commit

是和 interrupt 相关的，delayed commit 设置的时候不能进行 interrupt.

## 指令分别调用哪个 advancepc

1. riscv staticinst: 正常 advance,(pc, npc) -> (npc, npc + instwioth).
2. riscv macroinst: 同 riscv staticinst， 正常 advance。
3. riscv microinst: 没到最后一条 micro 只更新 npc (pc, upc, npc, unpc) -> (pc, unpc, npc, unpc + 1) 。到了最后一条进入到程序意义上的下一条指令(pc, upc, npc, unpc) -> (npc, 0, npc + instwidth, 1),