# riscv 取指之后的译码

decoder 和 generic::basicdecodecache 之间的协作。

## cpu decode cache

定义了 instmap(machinst->staticinstptr)，以及一个对于内存内容的 cache。

具体看[cpu decode cache](../gem5src/cpu/decode_cache.md)

## basic decode cache

```cpp
template <typename Decoder, typename EMI>
class BasicDecodeCache
{
  private:
    // EMI -> staticinst
    decode_cache::InstMap<EMI> instMap;
    struct AddrMapEntry
    {
        StaticInstPtr inst;
        EMI machInst;
    };
    // addr -> AddrMapEntry
    decode_cache::AddrMap<AddrMapEntry> decodePages;

  public:
    /// Decode a machine instruction.
    /// @param mach_inst The binary instruction to decode.
    /// @retval A pointer to the corresponding StaticInst object.
    StaticInstPtr
    decode(Decoder *const decoder, EMI mach_inst, Addr addr)
    {
        auto &entry = decodePages.lookup(addr);
        // 找的到且和当前的机器相同，直接返回机器指令
        if (entry.inst && (entry.machInst == mach_inst))
            return entry.inst;

        // 机器指令产生了变化，更新对应的机器指令
        entry.machInst = mach_inst;

        // 查找当前的 machine inst 有没有对应的 staticinst 缓存
        auto iter = instMap.find(mach_inst);
        // 有的话更新进去
        if (iter != instMap.end()) {
            entry.inst = iter->second;
            return entry.inst;
        }

        // 没有的话生成 static inst 并更新到 decode cache
        entry.inst = decoder->decodeInst(mach_inst);
        // 更新到 instmap 中
        instMap[mach_inst] = entry.inst;
        return entry.inst;
    }
};

```

## riscv decoder

```cpp
StaticInstPtr
Decoder::decode(ExtMachInst mach_inst, Addr addr)
{
    DPRINTF(Decode, "Decoding instruction 0x%08x at address %#x\n",
            mach_inst.instBits, addr);

    StaticInstPtr si = defaultCache.decode(this, mach_inst, addr);

    DPRINTF(Decode, "Decode: Decoded %s instruction: %#x\n",
            si->getName(), mach_inst);
    return si;
}

StaticInstPtr
Decoder::decode(PCStateBase &_next_pc)
{
    if (!instDone)
        return nullptr;
    instDone = false;

    auto &next_pc = _next_pc.as<PCState>();

    if (compressed(emi)) {
        next_pc.npc(next_pc.instAddr() + sizeof(machInst) / 2);
        next_pc.compressed(true);
    } else {
        next_pc.npc(next_pc.instAddr() + sizeof(machInst));
        next_pc.compressed(false);
    }

    emi.vtype8 = this->machVtype & 0xff;
    StaticInstPtr inst = decode(emi, next_pc.instAddr());
    if (inst->isVectorConfig()) {
        auto vset = static_cast<VConfOp*>(inst.get());
        if (vset->vtypeIsImm) {
            this->setVtype(vset->earlyVtype);
            VTYPE new_vtype = vset->earlyVtype;
        }
        else {
            this->clearVtype();
        }
    }

    return inst;
}

```

这里函数意义的理解就非常简单，就是从 cache 中拿。另外特别需要注意的是 decode 的时候会设置 npc。