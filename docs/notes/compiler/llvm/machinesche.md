# 指令调度重排

觉得这个东西很有意思，在编译的时候指定一个特定的机型，就能针对特定的机型优化代码。指令会针对机器的特点进行重排，这是 llvm 里面有一个 pass 做到的。

## 代码位置

通用的代码位置在 `/lib/CodeGen` 下，这个目录下的代码已经很接近机器的层次，是机器层次之上比较通用的优化代码。通用的指令排序调度器实现在 `MachineScheduler.cpp` 下，另外各个机型可以有自己特定的方案，这些特定的实现方案实现在 `Target` 目录下。

## 代码架构

指令调度是一个接近机器类型的调度，因此他在常用的 pass 之后。实际上就是对 LLVM IR 进行了一系列通用 pass 的优化之后，LLVM Pass 进行指令选择之后生成 MIR，然后通过对用户指定的机器模型信息进行指令的重新排序，在排序完成之后进行寄存器的分配，在寄存器分配完成之后，还会进行一次重排，然后还会经过称为软件流水线的 pass，对跨基本块的代码进行重新排序，可能还会有一些别的优化，最后生成指定的汇编代码。

## 实现

从指令选择完成之后，实际上指令选择之后或者说过程中还会生成一个 IselDAG 进行一个小规模的重新排序。在这之后就是针对特定机器模型的排序了，在对特定机器的机型进行排序之前，一定要定义特定机型的 tablegen 文件，在 tablegen 文件中，要定义功能单元的 port，发射队列使用到哪些 port，一个指令需要使用到哪些资源，使用到这些资源的延迟是多少，用于被 llvm 后端读取优化。然后 machine scheduler 的 pass 会将上面传过来的基本块链表迭代进行一块一块的优化，因此，machine scheduler 的重排是以基本块为单位的，在基本块之内还会将基本快拆成多个 region，以每个 region 为单位进行重排，region 的边界是不能重排的指令比如 atomic barrier 等等或者内联的编译器屏障。在这之后会进入到后续的 pass 最终生成机器代码。

这个过程在我看来实际上是利用静态的信息模拟了动态流水线，利用档当前静态的信息模拟出指令的调度，然后进行指令的重排，和 cpu 的动态执行是一个逆过程。但是编译器实际上知道的硬件信息还是有限的静态的，这是没办法将代码优化到最优的原因。也是为什么内联汇编效率很多情况下还是会高于编译器优化的原因，因为作为写代码的人能够知道更多的动态信息。这也是 jit 广泛应用的原因，动态确实能获得更多的信息。

```cpp
// MachineFunction 封装了一系列对机器访问的函数
// TargetMachine 应该是指定的机器类型
bool MachineSchedulerImpl::run(MachineFunction &Func, const TargetMachine &TM,
                               const RequiredAnalyses &Analyses) {
  MF = &Func;
  MLI = &Analyses.MLI;
  MDT = &Analyses.MDT;
  this->TM = &TM;
  AA = &Analyses.AA;
  LIS = &Analyses.LIS;

  // 在调度之前的验证
  if (VerifyScheduling) {
    LLVM_DEBUG(LIS->dump());
    const char *MSchedBanner = "Before machine scheduling.";
    if (P)
      MF->verify(P, MSchedBanner, &errs());
    else
      MF->verify(*MFAM, MSchedBanner, &errs());
  }
  // 获取机器寄存器信息
  RegClassInfo->runOnMachineFunction(*MF);

  // Instantiate the selected scheduler for this target, function, and
  // optimization level.
  // 创建 scheduler，默认是 generic scheduler，特定的机型也能够指定自己的实现
  std::unique_ptr<ScheduleDAGInstrs> Scheduler(createMachineScheduler());
  // 调度
  scheduleRegions(*Scheduler, false);

  // 调度后的验证
  LLVM_DEBUG(LIS->dump());
  if (VerifyScheduling) {
    const char *MSchedBanner = "After machine scheduling.";
    if (P)
      MF->verify(P, MSchedBanner, &errs());
    else
      MF->verify(*MFAM, MSchedBanner, &errs());
  }
  return true;
}

```

pass 的入口基本如上，从 `scheduleRegions` 进入调度。

```cpp
/// Main driver for both MachineScheduler and PostMachineScheduler.
void MachineSchedulerBase::scheduleRegions(ScheduleDAGInstrs &Scheduler,
                                           bool FixKillFlags) {
  // Visit all machine basic blocks.
  //
  // TODO: Visit blocks in global postorder or postorder within the bottom-up
  // loop tree. Then we can optionally compute global RegPressure.
  // 迭代 block 进行调度
  for (MachineFunction::iterator MBB = MF->begin(), MBBEnd = MF->end();
       MBB != MBBEnd; ++MBB) {

    Scheduler.startBlock(&*MBB);

#ifndef NDEBUG
    if (SchedOnlyFunc.getNumOccurrences() && SchedOnlyFunc != MF->getName())
      continue;
    if (SchedOnlyBlock.getNumOccurrences()
        && (int)SchedOnlyBlock != MBB->getNumber())
      continue;
#endif

    // Break the block into scheduling regions [I, RegionEnd). RegionEnd
    // points to the scheduling boundary at the bottom of the region. The DAG
    // does not include RegionEnd, but the region does (i.e. the next
    // RegionEnd is above the previous RegionBegin). If the current block has
    // no terminator then RegionEnd == MBB->end() for the bottom region.
    //
    // All the regions of MBB are first found and stored in MBBRegions, which
    // will be processed (MBB) top-down if initialized with true.
    //
    // The Scheduler may insert instructions during either schedule() or
    // exitRegion(), even for empty regions. So the local iterators 'I' and
    // 'RegionEnd' are invalid across these calls. Instructions must not be
    // added to other regions than the current one without updating MBBRegions.

    MBBRegionsVector MBBRegions;
    // 将 block 划分成多个 region
    getSchedRegions(&*MBB, MBBRegions, Scheduler.doMBBSchedRegionsTopDown());
    bool ScheduleSingleMI = Scheduler.shouldScheduleSingleMIRegions();
    // 对各个 region 进行调度
    for (const SchedRegion &R : MBBRegions) {
      MachineBasicBlock::iterator I = R.RegionBegin;
      MachineBasicBlock::iterator RegionEnd = R.RegionEnd;
      unsigned NumRegionInstrs = R.NumRegionInstrs;

      // Notify the scheduler of the region, even if we may skip scheduling
      // it. Perhaps it still needs to be bundled.
      Scheduler.enterRegion(&*MBB, I, RegionEnd, NumRegionInstrs);

      // Skip empty scheduling regions and, conditionally, regions with a single
      // MI.
      if (I == RegionEnd || (!ScheduleSingleMI && I == std::prev(RegionEnd))) {
        // Close the current region. Bundle the terminator if needed.
        // This invalidates 'RegionEnd' and 'I'.
        Scheduler.exitRegion();
        continue;
      }
      LLVM_DEBUG(dbgs() << "********** MI Scheduling **********\n");
      LLVM_DEBUG(dbgs() << MF->getName() << ":" << printMBBReference(*MBB)
                        << " " << MBB->getName() << "\n  From: " << *I
                        << "    To: ";
                 if (RegionEnd != MBB->end()) dbgs() << *RegionEnd;
                 else dbgs() << "End\n";
                 dbgs() << " RegionInstrs: " << NumRegionInstrs << '\n');
      if (DumpCriticalPathLength) {
        errs() << MF->getName();
        errs() << ":%bb. " << MBB->getNumber();
        errs() << " " << MBB->getName() << " \n";
      }

      // Schedule a region: possibly reorder instructions.
      // This invalidates the original region iterators.
      // 核心调度函数
      Scheduler.schedule();

      // Close the current region.
      Scheduler.exitRegion();
    }
    Scheduler.finishBlock();
    // FIXME: Ideally, no further passes should rely on kill flags. However,
    // thumb2 size reduction is currently an exception, so the PostMIScheduler
    // needs to do this.
    if (FixKillFlags)
      Scheduler.fixupKills(*MBB);
  }
  Scheduler.finalizeSchedule();
}
```

由于默认是 generic scheduler 调度器，因此参考 generic 调度器的实现。

```cpp
void ScheduleDAGMILive::schedule() {
  LLVM_DEBUG(dbgs() << "ScheduleDAGMILive::schedule starting\n");
  LLVM_DEBUG(SchedImpl->dumpPolicy());
  // 对 region 创建 DAG 同时创建对寄存器的压力分析
  buildDAGWithRegPressure();

  // 创建 DAG 之后的后处理，可能会进行一些 macro fusion
  postProcessDAG();

  SmallVector<SUnit*, 8> TopRoots, BotRoots;
  findRootsAndBiasEdges(TopRoots, BotRoots);

  // Initialize the strategy before modifying the DAG.
  // This may initialize a DFSResult to be used for queue priority.
  SchedImpl->initialize(this);

  LLVM_DEBUG(dump());
  if (PrintDAGs) dump();
  if (ViewMISchedDAGs) viewGraph();

  // Initialize ready queues now that the DAG and priority data are finalized.
  // 初始化队列，可能就是将能被调度的入队
  initQueues(TopRoots, BotRoots);

  bool IsTopNode = false;
  while (true) {
    LLVM_DEBUG(dbgs() << "** ScheduleDAGMILive::schedule picking next node\n");
    // 选取被前提的指令
    // 这个前提的指令是通过优化算法算出来的
    // 有 top - down 的选法和 bottom up 的选法
    // top-down 能够提升并行性，因为会充分利用空闲的寄存器
    // 寄存器压力大的时候应该会 bottom up，尽量让后面的相关的和前面依赖的接上
    SUnit *SU = SchedImpl->pickNode(IsTopNode);
    if (!SU) break;

    assert(!SU->isScheduled && "Node already scheduled");
    if (!checkSchedLimit())
      break;

    // 前提
    // 更新指令在基本块中的位置
    scheduleMI(SU, IsTopNode);

    if (DFSResult) {
      unsigned SubtreeID = DFSResult->getSubtreeID(SU);
      if (!ScheduledTrees.test(SubtreeID)) {
        ScheduledTrees.set(SubtreeID);
        DFSResult->scheduleTree(SubtreeID);
        SchedImpl->scheduleTree(SubtreeID);
      }
    }

    // Notify the scheduling strategy after updating the DAG.
    SchedImpl->schedNode(SU, IsTopNode);

    updateQueues(SU, IsTopNode);
  }
  assert(CurrentTop == CurrentBottom && "Nonempty unscheduled zone.");

  placeDebugValues();

  LLVM_DEBUG({
    dbgs() << "*** Final schedule for "
           << printMBBReference(*begin()->getParent()) << " ***\n";
    dumpSchedule();
    dbgs() << '\n';
  });
}

```

这里可能需要关注到的是 macro fusion 和 micro fusion 的区别，macro fusion 是编译器角度的融合，只是将两条指令排在一起，让硬件连续的拿到两条指令方便一些操作，micro fusion 是硬件上的指令融合，是真的将两条指令融合成一条执行了。

在 picknode 中会后后续调用函数选取 candidate:

```cpp
void GenericScheduler::pickNodeFromQueue(SchedBoundary &Zone,
                                         const CandPolicy &ZonePolicy,
                                         const RegPressureTracker &RPTracker,
                                         SchedCandidate &Cand) {
  // getMaxPressureDelta temporarily modifies the tracker.
  RegPressureTracker &TempTracker = const_cast<RegPressureTracker&>(RPTracker);

  ReadyQueue &Q = Zone.Available;
  for (SUnit *SU : Q) {

    SchedCandidate TryCand(ZonePolicy);
    initCandidate(TryCand, SU, Zone.isTop(), RPTracker, TempTracker);
    // Pass SchedBoundary only when comparing nodes from the same boundary.
    SchedBoundary *ZoneArg = Cand.AtTop == TryCand.AtTop ? &Zone : nullptr;
    if (tryCandidate(Cand, TryCand, ZoneArg)) {
      // Initialize resource delta if needed in case future heuristics query it.
      if (TryCand.ResDelta == SchedResourceDelta())
        TryCand.initResourceDelta(DAG, SchedModel);
      Cand.setBest(TryCand);
      LLVM_DEBUG(traceCandidate(Cand));
    }
  }
}

```