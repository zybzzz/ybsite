# xiangshan gem5 中的非对其内存访问

实际上不应该只针对 xiangshan gem5，这应该是 risc-v 全系统仿真对非对齐内存访问的处理。对于非对其内存访问的处理，要看处理器是不是支持非对齐的内存访问，对于不支持的情况触发异常之后可以直接 panic，对于支持的情况则是由操作系统将非对其的内存访问转化成多个连续的内存访问来解决问题。

这篇文章主要记录在 gem5 中发生非对其访问的时候的整个处理流程，在这里操作系统是 risc-v pk。

## iew 阶段

首先是非对齐内存访问的触发时刻，在 load 指令被执行的时候会调用 `LSQUnit::executeLoad` 的方法：

```cpp
Fault
LSQUnit::executeLoad(const DynInstPtr &inst)
{
    // Execute a specific load.
    Fault load_fault = NoFault;

    DPRINTF(LSQUnit, "Executing load PC %s, [sn:%lli]\n", inst->pcState(), inst->seqNum);

    assert(!inst->isSquashed());

    // 初始化内存访问
    load_fault = inst->initiateAcc();

    // ...
} 
```

在这个方法中调用了 `inst->initiateAcc()`，检查这个指令的实现可以发现：

``` cpp
 Fault
    Lhu::initiateAcc(ExecContext *xc,
        Trace::InstRecord *traceData) const
    {
        Addr EA;

        uint64_t Rs1 = 0;
        uint16_t Mem = {};
        Rs1 = xc->getRegOperand(this, 0);

        EA = Rs1 + offset;;

        return initiateMemRead(xc, traceData, EA, Mem, memAccessFlags);
    }

```

可以看到最后调用的是 `initiateMemRead` 的方法：

```cpp
template <class XC>
Fault
initiateMemRead(XC *xc, Addr addr, std::size_t size,
                Request::Flags flags,
                const std::vector<bool> &byte_enable)
{
    return xc->initiateMemRead(addr, size, flags, byte_enable);
}

template <class XC, class MemT>
Fault
initiateMemRead(XC *xc, Trace::InstRecord *traceData, Addr addr,
                MemT &mem, Request::Flags flags)
{
    static const std::vector<bool> byte_enable(sizeof(MemT), true);
    return initiateMemRead(xc, addr, sizeof(MemT),
                           flags, byte_enable);
}

```

这个方法实现在 memhelp 中，可以看到实际上是调用 dyn_inst 的同名方法：

```cpp
Fault
DynInst::initiateMemRead(Addr addr, unsigned size, Request::Flags flags,
                               const std::vector<bool> &byte_enable)
{
    assert(byte_enable.size() == size);
    return cpu->pushRequest(
        dynamic_cast<DynInstPtr::PtrType>(this),
        /* ld */ true, nullptr, size, addr, flags, nullptr, nullptr,
        byte_enable);
}
```

追踪到 dyn_inst 之后发现，其调用的是 o3cpu 的同名方法：

```cpp
Fault
pushRequest(const DynInstPtr& inst, bool isLoad, uint8_t *data,
            unsigned int size, Addr addr, Request::Flags flags,
            uint64_t *res, AtomicOpFunctorPtr amo_op = nullptr,
            const std::vector<bool>& byte_enable=std::vector<bool>())

{
    return iew.ldstQueue.pushRequest(inst, isLoad, data, size, addr,
            flags, res, std::move(amo_op), byte_enable);
}
```

可以看到其调用的是 ld/st queue 的 pushrequest 方法，而在 pushrequest 方法中:

```cpp
if (isLoad)
    fault = read(request, inst->lqIdx);
else
    fault = write(request, data, inst->sqIdx);
// inst->getFault() may have the first-fault of a
// multi-access split request at this point.
// Overwrite that only if we got another type of fault
// (e.g. re-exec).
if (fault != NoFault)
    inst->getFault() = fault;
```

对于 TLB 命中的 load，会调用 read 方法:

```cpp
Fault
LSQ::read(LSQRequest* request, ssize_t load_idx)
{
    assert(request->req()->contextId() == request->contextId());
    ThreadID tid = cpu->contextToThread(request->req()->contextId());

    return thread.at(tid).read(request, load_idx);
}
```

实际上调用的是 lsqunit 的 read 方法：

```cpp
if (!load_inst->isVector() && request->mainReq()->getSize() > 1 &&
        request->mainReq()->getVaddr() % request->mainReq()->getSize() != 0) {
    DPRINTF(LSQUnit, "request: size: %u, Addr: %#lx, code: %d\n", request->mainReq()->getSize(),
            request->mainReq()->getVaddr(), RiscvISA::ExceptionCode::LOAD_ADDR_MISALIGNED);
    return std::make_shared<RiscvISA::AddressFault>(request->mainReq()->getVaddr(),
                                                    RiscvISA::ExceptionCode::LOAD_ADDR_MISALIGNED);
}
```

就在这个方法中进行了判断，并发现了不对齐的内存访问，生成了 fault 并返回，这个 fault 会被记录到 dyn_inst 中,在上文提到的 `pushrequest` 中记录。这时候异常产生并被记录了，等到后续的提交阶段。这个非对其的内存访问能够被处理。

## commit 阶段

commit 阶段对这个非对齐访问异常的处理在这个异常指令的提交时候，进行对这个异常的处理，然后在后续进行流水线的清空以及异常处理函数。

对于异常检测的发现在 commitHead 的时候，在 commitHead 之前 commit 还将当前指令的 pc 地址记录到 pc 中：

```cpp
    // Check if the instruction caused a fault.  If so, trap.
    Fault inst_fault = head_inst->getFault();

    // hardware transactional memory
    // if a fault occurred within a HTM transaction
    // ensure that the transaction aborts
    if (inst_fault != NoFault && head_inst->inHtmTransactionalState()) {
        // There exists a generic HTM fault common to all ISAs
        if (!std::dynamic_pointer_cast<GenericHtmFailureFault>(inst_fault)) {
            DPRINTF(HtmCpu,
                    "%s - fault (%s) encountered within transaction"
                    " - converting to GenericHtmFailureFault\n",
                    head_inst->staticInst->getName(), inst_fault->name());
            inst_fault = std::make_shared<GenericHtmFailureFault>(head_inst->getHtmTransactionUid(),
                                                                  HtmFailureFaultCause::EXCEPTION);
        }
        // If this point is reached and the fault inherits from the HTM fault,
        // then there is no need to raise a new fault
    }

    // Stores mark themselves as completed.
    if (!head_inst->isStore() && inst_fault == NoFault) {
        head_inst->setCompleted();
    }

    if (inst_fault != NoFault) {
        DPRINTF(CommitTrace, "[sn:%lu pc:%#lx] %s has a fault, mepc: %#lx, mcause: %#lx, mtval: %#lx\n",
                head_inst->seqNum, head_inst->pcState().instAddr(),
                head_inst->staticInst->disassemble(head_inst->pcState().instAddr()),
                cpu->readMiscRegNoEffect(RiscvISA::MiscRegIndex::MISCREG_MEPC, tid),
                cpu->readMiscRegNoEffect(RiscvISA::MiscRegIndex::MISCREG_MCAUSE, tid),
                cpu->readMiscRegNoEffect(RiscvISA::MiscRegIndex::MISCREG_MTVAL, tid));

        if (!iewStage->flushAllStores(tid) || inst_num > 0) {
            DPRINTF(Commit,
                    "[tid:%i] [sn:%llu] "
                    "Stores outstanding, fault must wait.\n",
                    tid, head_inst->seqNum);
            return false;
        }

        head_inst->setCompleted();

        // If instruction has faulted, let the checker execute it and
        // check if it sees the same fault and control flow.
        if (cpu->checker) {
            // Need to check the instruction before its fault is processed
            cpu->checker->verify(head_inst);
        }

        assert(!thread[tid]->noSquashFromTC);

        // Mark that we're in state update mode so that the trap's
        // execution doesn't generate extra squashes.
        thread[tid]->noSquashFromTC = true;

        // 调用 cpu 的 trap 方法进行异常处理
        cpu->trap(inst_fault, tid, head_inst->notAnInst() ? nullStaticInstPtr : head_inst->staticInst);

        // Exit state update mode to avoid accidental updating.
        thread[tid]->noSquashFromTC = false;

        commitStatus[tid] = TrapPending;

        DPRINTF(Commit, "[tid:%i] [sn:%llu] %s Committing instruction with fault %s\n", tid, head_inst->seqNum,
                head_inst->staticInst->disassemble(head_inst->pcState().instAddr()).c_str(), inst_fault->name());

        DPRINTF(Faults, "[tid:%i] [sn:%llu] Fault instruction machInst: %lx\n", tid, head_inst->seqNum,
                dynamic_cast<RiscvISA::RiscvStaticInst &>(*head_inst->staticInst).machInst);


        // do difftest
        // ...

        // Generate trap squash event.
        generateTrapEvent(tid, inst_fault);
        return false;
    }

```

可以看到这里从 inst 中拿出了异常进行判断，对于有 fault 的相关情况，进行了相关的处理，其中重点注意的两点就是 cpu 进行 trap 和 生成一个 trap event。首先关注 cpu 的 trap 函数：

```cpp
void
CPU::trap(const Fault &fault, ThreadID tid, const StaticInstPtr &inst)
{
    // Pass the thread's TC into the invoke method.
    fault->invoke(threadContexts[tid], inst);
}
```

可以看到这个 trap 函数实际调用了 fault 内部的 invoke 函数，由于我们这里的 fault 是 AddressFault，他是 RiscvFault 的子类，自己并没有实现 invoke 方法，因此调用的还是 RiscvFault 的 invoke 方法，这个方式是 Riscv 异常和中断的统一处理函数：

```cpp
void
RiscvFault::invoke(ThreadContext *tc, const StaticInstPtr &inst)
{
    auto pc_state = tc->pcState().as<PCState>();

    DPRINTFS(Faults, tc->getCpuPtr(), "Fault (%s) at PC: %s\n",
             name(), pc_state);

    if (FullSystem) {
        PrivilegeMode pp = (PrivilegeMode)tc->readMiscReg(MISCREG_PRV);
        PrivilegeMode prv = PRV_M;
        STATUS status = tc->readMiscReg(MISCREG_STATUS);

        // According to riscv-privileged-v1.11, if a NMI occurs at the middle
        // of a M-mode trap handler, the state (epc/cause) will be overwritten
        // and is not necessary recoverable. There's nothing we can do here so
        // we'll just warn our user that the CPU state might be broken.
        warn_if(isNonMaskableInterrupt() && pp == PRV_M && status.mie == 0,
                "NMI overwriting M-mode trap handler state");

        // Set fault handler privilege mode
        if (isNonMaskableInterrupt()) {
            prv = PRV_M;
        } else if (isInterrupt()) {
            if (pp != PRV_M &&
                bits(tc->readMiscReg(MISCREG_MIDELEG), _code) != 0) {
                prv = PRV_S;
            }
            if (pp == PRV_U &&
                bits(tc->readMiscReg(MISCREG_SIDELEG), _code) != 0) {
                prv = PRV_U;
            }
        } else {
            if (pp != PRV_M &&
                bits(tc->readMiscReg(MISCREG_MEDELEG), _code) != 0) {
                prv = PRV_S;
            }
            if (pp == PRV_U &&
                bits(tc->readMiscReg(MISCREG_SEDELEG), _code) != 0) {
                prv = PRV_U;
            }
        }

        // Set fault registers and status
        MiscRegIndex cause, epc, tvec, tval;
        switch (prv) {
          case PRV_U:
            cause = MISCREG_UCAUSE;
            epc = MISCREG_UEPC;
            tvec = MISCREG_UTVEC;
            tval = MISCREG_UTVAL;

            status.upie = status.uie;
            status.uie = 0;
            break;
          case PRV_S:
            cause = MISCREG_SCAUSE;
            epc = MISCREG_SEPC;
            tvec = MISCREG_STVEC;
            tval = MISCREG_STVAL;

            status.spp = pp;
            status.spie = status.sie;
            status.sie = 0;
            break;
          case PRV_M:
            cause = MISCREG_MCAUSE;
            epc = MISCREG_MEPC;
            tvec = isNonMaskableInterrupt() ? MISCREG_NMIVEC : MISCREG_MTVEC;
            tval = MISCREG_MTVAL;

            status.mpp = pp;
            status.mpie = status.mie;
            status.mie = 0;
            break;
          default:
            panic("Unknown privilege mode %d.", prv);
            break;
        }

        // Set fault cause, privilege, and return PC
        // Interrupt is indicated on the MSB of cause (bit 63 in RV64)
        uint64_t _cause = _code;
        if (isInterrupt()) {
           _cause |= (1L << 63);
        }
        tc->setMiscReg(cause, _cause);
        tc->setMiscReg(epc, tc->pcState().instAddr());
        if (_cause == INST_ILLEGAL)
            tc->setMiscReg(tval, 0);
        else
            tc->setMiscReg(tval, trap_value());
        tc->setMiscReg(MISCREG_PRV, prv);
        tc->setMiscReg(MISCREG_STATUS, status);
        // Temporarily mask NMI while we're in NMI handler. Otherweise, the
        // checkNonMaskableInterrupt will always return true and we'll be
        // stucked in an infinite loop.
        if (isNonMaskableInterrupt()) {
            tc->setMiscReg(MISCREG_NMIE, 0);
        }

        // Set PC to fault handler address
        Addr addr = mbits(tc->readMiscReg(tvec), 63, 2);
        if (isInterrupt() && bits(tc->readMiscReg(tvec), 1, 0) == 1)
            addr += 4 * _code;
        pc_state.set(addr);
        tc->pcState(pc_state);
    } else {
        inst->advancePC(pc_state);
        tc->pcState(pc_state);
        invokeSE(tc, inst);
    }
}

```

可以看到的这是比较标准的进入中断处理函数之前的过程，即根据当前的一些 csr 寄存器状态设置终端函数入口的地址，可以看到这里实际上根据中断的原因计算出了中断服务函数的地址，又把中断处理函数的地址设置给 pc_state，再将这个 pc_state 赋值给 tc，tc 实际上是 threadcontext 的简称，他由 o3cpu 提供，实际上通过追踪嗯可以发现，tc->threadcontext.pc_state 实际上是指向 commic.pc 的引用，实际上是把 commit 的 pc 变量设置成这个值，也就是说，现在 commit 的 pc 变量已经是中断异常处理函数的入口地址了，等到后续这个地址给到取指阶段，就能够进入到中断处理函数的处理了。

在关注完 trap 之后再来关注 `generateTrapEvent`:

```cpp
void
Commit::generateTrapEvent(ThreadID tid, Fault inst_fault)
{
    DPRINTF(Commit, "Generating trap event for [tid:%i]\n", tid);

    EventFunctionWrapper *trap =
        new EventFunctionWrapper([this, tid] { processTrapEvent(tid); }, "Trap", true, Event::CPU_Tick_Pri);

    Cycles latency = std::dynamic_pointer_cast<SyscallRetryFault>(inst_fault) ? cpu->syscallRetryLatency : trapLatency;

    // hardware transactional memory
    if (inst_fault != nullptr && std::dynamic_pointer_cast<GenericHtmFailureFault>(inst_fault)) {
        // TODO
        // latency = default abort/restore latency
        // could also do some kind of exponential back off if desired
    }

    cpu->schedule(trap, cpu->clockEdge(latency));
    trapInFlight[tid] = true;
    thread[tid]->trapPending = true;
}
```

这个函数的核心就是创建一个事件，按照一定的延时触发事件，进入到这个事件的回调函数可以看到：

```cpp
void
Commit::processTrapEvent(ThreadID tid)
{
    trapSquash[tid] = true;
}
```

可以看到这里将 trapsquash 这个变量设置成了 true。对于 `generateTrapEvent` 这个事件最简单的理解就是在一定时间之内将 trapsquash 变量设置成 true，并且在等待的这段时间内，cpu 处于 trapPending 状态。

以上就是 commithead 在遇到异常时候的情况，在遇到异常相关指令的时候 commithead 所在的循环就不会进行下去了，一个 commit 流程也基本结束了。

## 后续时钟周期的 commit

由于当前 cpu 处在 trappending 状态，因此后续指令都不会进行正常的提交，而是等待回调事件的触发。在事件触发并正确设置变量之后：

```cpp
if (trapSquash[tid]) {
    assert(!tcSquash[tid]);
    squashFromTrap(tid);

    if (cpu->isThreadExiting(tid))
        cpu->scheduleThreadExitEvent(tid);
} //else ...

```

实际上调用的是 squashFromTrap 这个函数：

```cpp
void
Commit::squashFromTrap(ThreadID tid)
{
    squashAll(tid);

    toIEW->commitInfo[tid].isTrapSquash = true;
    toIEW->commitInfo[tid].committedPC = committedPC[tid];

    DPRINTF(Commit, "Squashing from trap, restarting at PC %s\n", *pc[tid]);

    thread[tid]->trapPending = false;
    thread[tid]->noSquashFromTC = false;
    trapInFlight[tid] = false;

    trapSquash[tid] = false;

    commitStatus[tid] = ROBSquashing;
    cpu->activityThisCycle();
}
```

这个函数中实际上对变量进行了一些设置，这之中还调用了 squashAll 函数：

```cpp
void
Commit::squashAll(ThreadID tid)
{
    // If we want to include the squashing instruction in the squash,
    // then use one older sequence number.
    // Hopefully this doesn't mess things up.  Basically I want to squash
    // all instructions of this thread.
    InstSeqNum squashed_inst = rob->isEmpty(tid) ? lastCommitedSeqNum[tid] : rob->readHeadInst(tid)->seqNum - 1;

    // All younger instructions will be squashed. Set the sequence
    // number as the youngest instruction in the ROB (0 in this case.
    // Hopefully nothing breaks.)
    youngestSeqNum[tid] = lastCommitedSeqNum[tid];

    rob->squash(squashed_inst, tid);
    changedROBNumEntries[tid] = true;

    // todo: value prediction also squash in this, this maybe bug
    valuePredictor->squash(squashed_inst);

    // Send back the sequence number of the squashed instruction.
    toIEW->commitInfo[tid].doneSeqNum = squashed_inst;

    // Send back the squash signal to tell stages that they should
    // squash.
    toIEW->commitInfo[tid].squash = true;

    // Send back the rob squashing signal so other stages know that
    // the ROB is in the process of squashing.
    toIEW->commitInfo[tid].robSquashing = true;

    toIEW->commitInfo[tid].mispredictInst = NULL;
    toIEW->commitInfo[tid].squashInst = NULL;

    set(toIEW->commitInfo[tid].pc, pc[tid]);

    toIEW->commitInfo[tid].squashedStreamId = committedStreamId;
    toIEW->commitInfo[tid].squashedTargetId = committedTargetId;
    toIEW->commitInfo[tid].squashedLoopIter = committedLoopIter;

    squashInflightAndUpdateVersion(tid);
}

```

这里就比较关键，这里不仅清空了 rob，更把 pc 这个变量的值向前阶段进行传递，至此 fetch 阶段拿到中断服务函数的地址，中断服务的过程就开始了，中断服务函数的过程就实现在 riscv-pk 中。

## riscv-pk

通过观察之前产生 fault 时候使用的中断向量号，可以发现非对齐内存访问的中断号为 4，到 riscv-pk 中去找，发现在 machine/mentry.S 中：

```cpp
trap_table:
#define BAD_TRAP_VECTOR 0
  /* 00 */ .dc.a bad_trap
  /* 01 */ .dc.a pmp_trap
  /* 02 */ .dc.a illegal_insn_trap
  /* 03 */ .dc.a bad_trap
  /* 04 */ .dc.a misaligned_load_trap
  /* 05 */ .dc.a pmp_trap
```

有同样的中断向量号的定义。后来发现在 machine/misaligned_ldst.c 中确实实现了一个 `misaligned_load_trap` 函数，应该就是中断向量函数：

```c
void misaligned_load_trap(uintptr_t* regs, uintptr_t mcause, uintptr_t mepc)
{
  union byte_array val;
  uintptr_t mstatus;
  insn_t insn = get_insn(mepc, &mstatus);
  uintptr_t npc = mepc + insn_len(insn);
  uintptr_t addr = read_csr(mtval);

  int shift = 0, fp = 0, len;
  if ((insn & MASK_LW) == MATCH_LW)
    len = 4, shift = 8*(sizeof(uintptr_t) - len);
#if __riscv_xlen == 64
  else if ((insn & MASK_LD) == MATCH_LD)
    len = 8, shift = 8*(sizeof(uintptr_t) - len);
  else if ((insn & MASK_LWU) == MATCH_LWU)
    len = 4;
#endif
#ifdef PK_ENABLE_FP_EMULATION
  else if ((insn & MASK_FLD) == MATCH_FLD)
    fp = 1, len = 8;
  else if ((insn & MASK_FLW) == MATCH_FLW)
    fp = 1, len = 4;
  else if ((insn & MASK_FLH) == MATCH_FLH)
    fp = 1, len = 2;
#endif
  else if ((insn & MASK_LH) == MATCH_LH)
    len = 2, shift = 8*(sizeof(uintptr_t) - len);
  else if ((insn & MASK_LHU) == MATCH_LHU)
    len = 2;
#ifdef __riscv_vector
  else if ((insn & (MASK_VLE8_V & 0x707f)) == (MATCH_VLE8_V & 0x707f)
           || (insn & (MASK_VLE16_V & 0x707f)) == (MATCH_VLE16_V & 0x707f)
           || (insn & (MASK_VLE32_V & 0x707f)) == (MATCH_VLE32_V & 0x707f)
           || (insn & (MASK_VLE64_V & 0x707f)) == (MATCH_VLE64_V & 0x707f))
    return misaligned_vec_ldst(regs, mcause, mepc, mstatus, insn);
#endif
#ifdef __riscv_compressed
# if __riscv_xlen >= 64
  else if ((insn & MASK_C_LD) == MATCH_C_LD)
    len = 8, shift = 8*(sizeof(uintptr_t) - len), insn = RVC_RS2S(insn) << SH_RD;
  else if ((insn & MASK_C_LDSP) == MATCH_C_LDSP && ((insn >> SH_RD) & 0x1f))
    len = 8, shift = 8*(sizeof(uintptr_t) - len);
# endif
  else if ((insn & MASK_C_LW) == MATCH_C_LW)
    len = 4, shift = 8*(sizeof(uintptr_t) - len), insn = RVC_RS2S(insn) << SH_RD;
  else if ((insn & MASK_C_LWSP) == MATCH_C_LWSP && ((insn >> SH_RD) & 0x1f))
    len = 4, shift = 8*(sizeof(uintptr_t) - len);
# ifdef PK_ENABLE_FP_EMULATION
  else if ((insn & MASK_C_FLD) == MATCH_C_FLD)
    fp = 1, len = 8, insn = RVC_RS2S(insn) << SH_RD;
  else if ((insn & MASK_C_FLDSP) == MATCH_C_FLDSP)
    fp = 1, len = 8;
#  if __riscv_xlen == 32
  else if ((insn & MASK_C_FLW) == MATCH_C_FLW)
    fp = 1, len = 4, insn = RVC_RS2S(insn) << SH_RD;
  else if ((insn & MASK_C_FLWSP) == MATCH_C_FLWSP)
    fp = 1, len = 4;
#  endif
# endif
#endif
  else {
    mcause = CAUSE_LOAD_ACCESS;
    write_csr(mcause, mcause);
    return truly_illegal_insn(regs, mcause, mepc, mstatus, insn);
  }

  val.int64 = 0;
  for (intptr_t i = 0; i < len; i++)// [!code highlight]
    val.bytes[i] = load_uint8_t((void *)(addr + i), mepc);// [!code highlight]

  if (!fp)
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
    SET_RD(insn, regs, (intptr_t)val.intx << shift >> shift);
#else
    SET_RD(insn, regs, (intptr_t)val.intx >> shift);
#endif
  else if (len == 8)
    SET_F64_RD(insn, regs, val.int64);
  else if (len == 4)
    SET_F32_RD(insn, regs, val.int32);
  else
    SET_F32_RD(insn, regs, val.int16 | 0xffff0000U);

  write_csr(mepc, npc);
}

```

可以看到上面函数中的 for 循环就是把一个非对齐的 load 拆成多个 load 进行对齐的访问，这时候应该能够感觉到，原先的非对齐的 load 访问在这个中断处理函数执行完成之后就完成了，数值也被写回寄存器了。更为关键的是这个函数的最后还利用传入的地址计算出了返回地址，其实就是当前指令的下一条指令，并写回到 mepc 这个 csr中，即 `write_csr(mepc, npc);`，等最后调用 mret 的时候就返回了。整个处理过程就这么完成了。

注意上面的中断处理函数都是在 gem5 中执行的。
