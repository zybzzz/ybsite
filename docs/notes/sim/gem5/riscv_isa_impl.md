# 一些 gem5 中 riscv ISA 的实现

## fence

```cpp
0x03: decode FUNCT3 {
            format FenceOp {
                0x0: fence({{
                }}, uint64_t, IsReadBarrier, IsWriteBarrier, No_OpClass);
                0x1: fence_i({{
                }}, uint64_t, IsNonSpeculative, IsSerializeAfter, No_OpClass);
            }
        }
```

传入的 code 部分为空，说明其 exec 为空实现，同时这两条不同的指令被加上了不同的标记。

## 一些 system 指令

```cpp
format SystemOp {
                0x0: decode FUNCT7 {
                    0x0: decode RS2 {
                        0x0: ecall({{
                            return std::make_shared<SyscallFault>(
                                (PrivilegeMode)xc->readMiscReg(MISCREG_PRV));
                        }}, IsSerializeAfter, IsNonSpeculative, IsSyscall,
                            No_OpClass);
                        0x1: ebreak({{
                            return std::make_shared<BreakpointFault>(
                                xc->pcState());
                        }}, IsSerializeAfter, IsNonSpeculative, No_OpClass);
                        0x2: uret({{
                            STATUS status = xc->readMiscReg(MISCREG_STATUS);
                            status.uie = status.upie;
                            status.upie = 1;
                            xc->setMiscReg(MISCREG_STATUS, status);
                            NPC = xc->readMiscReg(MISCREG_UEPC);
                        }}, IsSerializeAfter, IsNonSpeculative, IsReturn);
                    }
                    0x8: decode RS2 {
                        0x2: sret({{
                            STATUS status = xc->readMiscReg(MISCREG_STATUS);
                            auto pm = (PrivilegeMode)xc->readMiscReg(
                                MISCREG_PRV);
                            if (pm == PRV_U ||
                                (pm == PRV_S && status.tsr == 1)) {
                                return std::make_shared<IllegalInstFault>(
                                            "sret in user mode or TSR enabled",
                                            machInst);
                                NPC = NPC;
                            } else {
                                xc->setMiscReg(MISCREG_PRV, status.spp);
                                status.sie = status.spie;
                                status.spie = 1;
                                status.spp = PRV_U;
                                xc->setMiscReg(MISCREG_STATUS, status);
                                NPC = xc->readMiscReg(MISCREG_SEPC);
                            }
                        }}, IsSerializeAfter, IsNonSpeculative, IsReturn);
                        0x5: wfi({{
                            STATUS status = xc->readMiscReg(MISCREG_STATUS);
                            auto pm = (PrivilegeMode)xc->readMiscReg(
                                MISCREG_PRV);
                            if (pm == PRV_U ||
                                (pm == PRV_S && status.tw == 1)) {
                                return std::make_shared<IllegalInstFault>(
                                            "wfi in user mode or TW enabled",
                                            machInst);
                            }
                            // don't do anything for now
                        }}, No_OpClass);
                    }
                    0x9: sfence_vma({{
                        STATUS status = xc->readMiscReg(MISCREG_STATUS);
                        auto pm = (PrivilegeMode)xc->readMiscReg(MISCREG_PRV);
                        if (pm == PRV_U || (pm == PRV_S && status.tvm == 1)) {
                            return std::make_shared<IllegalInstFault>(
                                        "sfence in user mode or TVM enabled",
                                        machInst);
                        }
                        xc->tcBase()->getMMUPtr()->demapPage(Rs1, Rs2);
                    }}, IsNonSpeculative, IsSerializeAfter, No_OpClass);
                    0x18: mret({{
                        if (xc->readMiscReg(MISCREG_PRV) != PRV_M) {
                            return std::make_shared<IllegalInstFault>(
                                        "mret at lower privilege", machInst);
                            NPC = NPC;
                        } else {
                            STATUS status = xc->readMiscReg(MISCREG_STATUS);
                            xc->setMiscReg(MISCREG_PRV, status.mpp);
                            xc->setMiscReg(MISCREG_NMIE, 1);
                            status.mie = status.mpie;
                            status.mpie = 1;
                            status.mpp = PRV_U;
                            xc->setMiscReg(MISCREG_STATUS, status);
                            NPC = xc->readMiscReg(MISCREG_MEPC);
                        }
                    }}, IsSerializeAfter, IsNonSpeculative, IsReturn);
```

code 中指定的是其进行的操作。

## AMO

RV64 的 AMO如下：

```cpp
 0x3: decode AMOFUNCT {
                0x2: LoadReserved::lr_d({{
                    Rd_sd = Mem_sd;
                }}, mem_flags=LLSC);
                0x3: StoreCond::sc_d({{
                    Mem = Rs2;
                }}, {{
                    Rd = result;
                }}, mem_flags=LLSC, inst_flags=IsStoreConditional);
                0x0: AtomicMemOp::amoadd_d({{
                    Rd_sd = Mem_sd;
                }}, {{
                    TypedAtomicOpFunctor<int64_t> *amo_op =
                          new AtomicGenericOp<int64_t>(Rs2_sd,
                                  [](int64_t* b, int64_t a){ *b += a; });
                }}, mem_flags=ATOMIC_RETURN_OP);
                0x1: AtomicMemOp::amoswap_d({{
                    Rd_sd = Mem_sd;
                }}, {{
                    TypedAtomicOpFunctor<uint64_t> *amo_op =
                          new AtomicGenericOp<uint64_t>(Rs2_ud,
                                  [](uint64_t* b, uint64_t a){ *b = a; });
                }}, mem_flags=ATOMIC_RETURN_OP);
                0x4: AtomicMemOp::amoxor_d({{
                    Rd_sd = Mem_sd;
                }}, {{
                    TypedAtomicOpFunctor<uint64_t> *amo_op =
                          new AtomicGenericOp<uint64_t>(Rs2_ud,
                                 [](uint64_t* b, uint64_t a){ *b ^= a; });
                }}, mem_flags=ATOMIC_RETURN_OP);
                0x8: AtomicMemOp::amoor_d({{
                    Rd_sd = Mem_sd;
                }}, {{
                    TypedAtomicOpFunctor<uint64_t> *amo_op =
                          new AtomicGenericOp<uint64_t>(Rs2_ud,
                                 [](uint64_t* b, uint64_t a){ *b |= a; });
                }}, mem_flags=ATOMIC_RETURN_OP);
                0xc: AtomicMemOp::amoand_d({{
                    Rd_sd = Mem_sd;
                }}, {{
                    TypedAtomicOpFunctor<uint64_t> *amo_op =
                          new AtomicGenericOp<uint64_t>(Rs2_ud,
                                 [](uint64_t* b, uint64_t a){ *b &= a; });
                }}, mem_flags=ATOMIC_RETURN_OP);
                0x10: AtomicMemOp::amomin_d({{
                    Rd_sd = Mem_sd;
                }}, {{
                    TypedAtomicOpFunctor<int64_t> *amo_op =
                      new AtomicGenericOp<int64_t>(Rs2_sd,
                        [](int64_t* b, int64_t a){ if (a < *b) *b = a; });
                }}, mem_flags=ATOMIC_RETURN_OP);
                0x14: AtomicMemOp::amomax_d({{
                    Rd_sd = Mem_sd;
                }}, {{
                    TypedAtomicOpFunctor<int64_t> *amo_op =
                      new AtomicGenericOp<int64_t>(Rs2_sd,
                        [](int64_t* b, int64_t a){ if (a > *b) *b = a; });
                }}, mem_flags=ATOMIC_RETURN_OP);
                0x18: AtomicMemOp::amominu_d({{
                    Rd_sd = Mem_sd;
                }}, {{
                    TypedAtomicOpFunctor<uint64_t> *amo_op =
                      new AtomicGenericOp<uint64_t>(Rs2_ud,
                        [](uint64_t* b, uint64_t a){ if (a < *b) *b = a; });
                }}, mem_flags=ATOMIC_RETURN_OP);
                0x1c: AtomicMemOp::amomaxu_d({{
                    Rd_sd = Mem_sd;
                }}, {{
                    TypedAtomicOpFunctor<uint64_t> *amo_op =
                      new AtomicGenericOp<uint64_t>(Rs2_ud,
                        [](uint64_t* b, uint64_t a){ if (a > *b) *b = a; });
                }}, mem_flags=ATOMIC_RETURN_OP);
            }
```

其各自具有不同的 format，需要到各自的 format 下进行查看。

## 无条件跳转

```cpp
0x19: decode FUNCT3 {
            0x0: Jump::jalr({{
                Rd = NPC;
                NPC = (imm + Rs1) & (~0x1);
            }}, IsIndirectControl, IsUncondControl);
        }

        0x1b: JOp::jal({{
            Rd = NPC;
            NPC = PC + imm;
        }}, IsDirectControl, IsUncondControl);
```

## 分支

```cpp
format BOp {
                0x0: beq({{
                    if (Rs1 == Rs2) {
                        NPC = PC + imm;
                    } else {
                        NPC = NPC;
                    }
                }}, IsDirectControl, IsCondControl);
                0x1: bne({{
                    if (Rs1 != Rs2) {
                        NPC = PC + imm;
                    } else {
                        NPC = NPC;
                    }
                }}, IsDirectControl, IsCondControl);
                0x4: blt({{
                    if (Rs1_sd < Rs2_sd) {
                        NPC = PC + imm;
                    } else {
                        NPC = NPC;
                    }
                }}, IsDirectControl, IsCondControl);
                0x5: bge({{
                    if (Rs1_sd >= Rs2_sd) {
                        NPC = PC + imm;
                    } else {
                        NPC = NPC;
                    }
                }}, IsDirectControl, IsCondControl);
                0x6: bltu({{
                    if (Rs1 < Rs2) {
                        NPC = PC + imm;
                    } else {
                        NPC = NPC;
                    }
                }}, IsDirectControl, IsCondControl);
                0x7: bgeu({{
                    if (Rs1 >= Rs2) {
                        NPC = PC + imm;
                    } else {
                        NPC = NPC;
                    }
                }}, IsDirectControl, IsCondControl);
            }
```

从代码很上还是很常规的操作。

```cpp
def format BOp(code, *opt_flags) {{
    imm_code = """
                imm = BIMM12BITS4TO1 << 1  |
                      BIMM12BITS10TO5 << 5 |
                      BIMM12BIT11 << 11    |
                      IMMSIGN << 12;
                imm = sext<13>(imm);
               """
    regs = ['srcRegIdx(0)','srcRegIdx(1)']
    iop = InstObjParams(name, Name, 'ImmOp<int64_t>',
        {'code': code, 'imm_code': imm_code,
         'regs': ','.join(regs)}, opt_flags)
    header_output = BranchDeclare.subst(iop)
    decoder_output = ImmConstructor.subst(iop)
    decode_block = BasicDecode.subst(iop)
    exec_output = BranchExecute.subst(iop)
}};
```

这是其 format 的定义，想重点关注 exec_output。

```cpp
def template BranchExecute {{
    Fault
    %(class_name)s::execute(ExecContext *xc,
        Trace::InstRecord *traceData) const
    {
        %(op_decl)s;
        %(op_rd)s;
        %(code)s;
        %(op_wb)s;
        return NoFault;
    }

    std::unique_ptr<PCStateBase>
    %(class_name)s::branchTarget(const PCStateBase &branch_pc) const
    {
        auto &rpc = branch_pc.as<RiscvISA::PCState>();
        return std::make_unique<PCState>(rpc.pc() + imm);
    }

    std::string
    %(class_name)s::generateDisassembly(
            Addr pc, const loader::SymbolTable *symtab) const
    {
        std::vector<RegId> indices = {%(regs)s};
        std::stringstream ss;
        ss << mnemonic << ' ';
        for (const RegId& idx: indices)
            ss << registerName(idx) << ", ";
        ss << imm;
        return ss.str();
    }
}};
```

可以看到对于分支指令有一个特别的 branchTarget 方法来获取分支的 target。

## 各种 Load

```cpp
0x00: decode FUNCT3 {
            format Load {
                0x0: lb({{
                    Rd_sd = Mem_sb;
                }});
                0x1: lh({{
                    Rd_sd = Mem_sh;
                }});
                0x2: lw({{
                    Rd_sd = Mem_sw;
                }});
                0x3: ld({{
                    Rd_sd = Mem_sd;
                }});
                0x4: lbu({{
                    Rd = Mem_ub;
                }});
                0x5: lhu({{
                    Rd = Mem_uh;
                }});
                0x6: lwu({{
                    Rd = Mem_uw;
                }});
            }
        }
```

操作倒是很简单。

在最后生成的执行代码会包含这三个代码模板：

```cpp
def template LoadExecute {{
    Fault
    %(class_name)s::execute(
        ExecContext *xc, Trace::InstRecord *traceData) const
    {
        Addr EA;

        %(op_decl)s;
        %(op_rd)s;
        %(ea_code)s;

        {
            Fault fault =
                readMemAtomicLE(xc, traceData, EA, Mem, memAccessFlags);
            if (fault != NoFault)
                return fault;
        }

        %(memacc_code)s;

        %(op_wb)s;

        return NoFault;
    }
}};

def template LoadInitiateAcc {{
    Fault
    %(class_name)s::initiateAcc(ExecContext *xc,
        Trace::InstRecord *traceData) const
    {
        Addr EA;

        %(op_src_decl)s;
        %(op_rd)s;
        %(ea_code)s;

        return initiateMemRead(xc, traceData, EA, Mem, memAccessFlags);
    }
}};

def template LoadCompleteAcc {{
    Fault
    %(class_name)s::completeAcc(PacketPtr pkt, ExecContext *xc,
        Trace::InstRecord *traceData) const
    {
        %(op_decl)s;
        %(op_rd)s;

        getMemLE(pkt, Mem, traceData);

        %(memacc_code)s;
        %(op_wb)s;

        return NoFault;
    }
}};
```

store 几乎同理。

```cpp
def template StoreExecute {{
    Fault
    %(class_name)s::execute(ExecContext *xc,
        Trace::InstRecord *traceData) const
    {
        Addr EA;

        %(op_decl)s;
        %(op_rd)s;
        %(ea_code)s;

        %(memacc_code)s;

        {
            Fault fault =
                writeMemAtomicLE(xc, traceData, Mem, EA, memAccessFlags,
                        nullptr);
            if (fault != NoFault)
                return fault;
        }

        %(postacc_code)s;
        %(op_wb)s;

        return NoFault;
    }
}};

def template StoreInitiateAcc {{
    Fault
    %(class_name)s::initiateAcc(ExecContext *xc,
        Trace::InstRecord *traceData) const
    {
        Addr EA;

        %(op_decl)s;
        %(op_rd)s;
        %(ea_code)s;

        %(memacc_code)s;

        {
            Fault fault = writeMemTimingLE(xc, traceData, Mem, EA,
                memAccessFlags, nullptr);
            if (fault != NoFault)
                return fault;
        }

        %(op_wb)s;

        return NoFault;
    }
}};

def template StoreCompleteAcc {{
    Fault
    %(class_name)s::completeAcc(PacketPtr pkt, ExecContext *xc,
        Trace::InstRecord *traceData) const
    {
        return NoFault;
    }
}};
```

同时注意到除了原本标记之外并没有加上其他的标记。

