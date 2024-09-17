# 为乱序访存封装的请求

## LSQRequest

LSQRequest 主要经历了地址翻译，发包收包的过程，并且在每个过程结束的时候可能都进行了 squash 的判断。访存过程中使用到的多个 LSQRequest 都是对原始的 LSQRequest 的封装。

```cpp
class LSQRequest : public BaseMMU::Translation, public Packet::SenderState
{
    protected:
    typedef uint32_t FlagsStorage;
    typedef Flags<FlagsStorage> FlagsType;

    //定义flag
    enum Flag : FlagsStorage
    {
        IsLoad              = 0x00000001,
        /** True if this request needs to writeBack to register.
            * Will be set in case of load or a store/atomic
            * that writes registers (SC)
            */
        WriteBackToRegister = 0x00000002,
        Delayed             = 0x00000004,
        IsSplit             = 0x00000008,
        /** True if any translation has been sent to TLB. */
        TranslationStarted  = 0x00000010,
        /** True if there are un-replied outbound translations.. */
        TranslationFinished = 0x00000020,
        Sent                = 0x00000040,
        Retry               = 0x00000080,
        Complete            = 0x00000100,
        /** Ownership tracking flags. */
        /** Translation squashed. */
        TranslationSquashed = 0x00000200,
        /** Request discarded */
        Discarded           = 0x00000400,
        /** LSQ resources freed. */
        LSQEntryFreed       = 0x00000800,
        /** Store written back. */
        WritebackScheduled  = 0x00001000,
        WritebackDone       = 0x00002000,
        /** True if this is an atomic request */
        IsAtomic            = 0x00004000
    };
    FlagsType flags;

    // 定义的当前的请求所处的状态
    enum class State
    {
        NotIssued,// 什么事都还没做
        Translation,// 正在地址翻译
        Request,// 正在请求内存进行数据访问
        Fault,//访问出错
        PartialFault,// 部分访问出错
    };
    State _state;
    void setState(const State& newState) { _state = newState; }

    // 对所有传输的段的定义
    uint32_t numTranslatedFragments;
    uint32_t numInTranslationFragments;


    void markDelayed() override { flags.set(Flag::Delayed); }
    bool isDelayed() { return flags.isSet(Flag::Delayed); }

    public:
    // 指向接收数据用的 port，lsq unit应该会代理处理
    LSQUnit& _port;
    // 指令
    const DynInstPtr _inst;
    // 任务 id 某些时候验证的时候用
    uint32_t _taskId;
    // 指向底层packet接受到数据的指针
    PacketDataPtr _data;
    // 指向底层通信的一系列 packet
    std::vector<PacketPtr> _packets;
    // 指向的是底层内存访问的 request
    std::vector<RequestPtr> _reqs;
    // 出现的错误
    std::vector<Fault> _fault;
    // 应该是最后总的结果
    uint64_t* _res;
    // 访问的地址
    const Addr _addr;
    // 访问的大小
    const uint32_t _size;
    // 底层内存访问的 flag
    const Request::Flags _flags;
    // 不明确
    std::vector<bool> _byteEnable;
    // 应该是指的已经翻译完成，但是还在进行内存访问的 request
    uint32_t _numOutstandingPackets;
    // 原子访存的时候附带的一些操作？
    AtomicOpFunctorPtr _amo_op;
    // 是否在翻译的时候停滞
    bool _hasStaleTranslation;

    struct FWDPacket
    {
        int idx;
        uint8_t byte;
    };
    std::vector<FWDPacket> forwardPackets;

    protected:
    LSQUnit* lsqUnit() { return &_port; }
    LSQRequest(LSQUnit* port, const DynInstPtr& inst, bool isLoad);
    LSQRequest(LSQUnit* port, const DynInstPtr& inst, bool isLoad,
            const Addr& addr, const uint32_t& size,
            const Request::Flags& flags_, PacketDataPtr data=nullptr,
            uint64_t* res=nullptr, AtomicOpFunctorPtr amo_op=nullptr,
            bool stale_translation=false);

    bool
    isLoad() const
    {
        return flags.isSet(Flag::IsLoad);
    }

    bool
    isAtomic() const
    {
        return flags.isSet(Flag::IsAtomic);
    }

    /** Install the request in the LQ/SQ. */
    void install();

    bool squashed() const override;


    /** Release the LSQRequest.
        * Notify the sender state that the request it points to is not valid
        * anymore. Understand if the request is orphan (self-managed) and if
        * so, mark it as freed, else destroy it, as this means
        * the end of its life cycle.
        * An LSQRequest is orphan when its resources are released
        * but there is any in-flight translation request to the TLB or access
        * request to the memory.
        */
    void
    release(Flag reason)
    {
        assert(reason == Flag::LSQEntryFreed || reason == Flag::Discarded);
        if (!isAnyOutstandingRequest()) {
            delete this;
        } else {
            flags.set(reason);
        }
    }

    /** Helper function used to add a (sub)request, given its address
        * `addr`, size `size` and byte-enable mask `byteEnable`.
        *
        * The request is only added if there is at least one active
        * element in the mask.
        */
    void addReq(Addr addr, unsigned size,
            const std::vector<bool>& byte_enable);

    void forward();

    /** Destructor.
        * The LSQRequest owns the request. If the packet has already been
        * sent, the sender state will be deleted upon receiving the reply.
        */
    virtual ~LSQRequest();

    public:
    /** Convenience getters/setters. */
    /** @{ */
    /** Set up Context numbers. */
    void
    setContext(const ContextID& context_id)
    {
        req()->setContext(context_id);
    }

    const DynInstPtr& instruction() { return _inst; }

    bool hasStaleTranslation() const { return _hasStaleTranslation; }

    virtual void markAsStaleTranslation() = 0;

    /** Set up virtual request.
        * For a previously allocated Request objects.
        */
    void
    setVirt(Addr vaddr, unsigned size, Request::Flags flags_,
            RequestorID requestor_id, Addr pc)
    {
        req()->setVirt(vaddr, size, flags_, requestor_id, pc);
    }

    ContextID contextId() const;

    // 批量赋值id
    void
    taskId(const uint32_t& v)
    {
        _taskId = v;
        for (auto& r: _reqs)
            r->taskId(v);
    }

    uint32_t taskId() const { return _taskId; }

    // 批量赋值附加的元数据
    void
    setXsMetadata(const Request::XsMetadata &v)
    {
        for (auto& r: _reqs)
            r->setXsMetadata(v);
    }

    RequestPtr req(int idx = 0) { return _reqs.at(idx); }
    const RequestPtr req(int idx = 0) const { return _reqs.at(idx); }

    Addr getVaddr(int idx = 0) const { return req(idx)->getVaddr(); }
    virtual void initiateTranslation() = 0;

    PacketPtr packet(int idx = 0) { return _packets.at(idx); }

    // 只能在数目为1的时候使用
    virtual PacketPtr
    mainPacket()
    {
        assert (_packets.size() == 1);
        return packet();
    }

    virtual RequestPtr
    mainReq()
    {
        assert (_reqs.size() == 1);
        return req();
    }

    /**
        * Test if there is any in-flight translation or mem access request
        */
    // 应该是当前还未完成的请求
    bool
    isAnyOutstandingRequest()
    {
        return numInTranslationFragments > 0 ||
            _numOutstandingPackets > 0 ||
            (flags.isSet(Flag::WritebackScheduled) &&
                !flags.isSet(Flag::WritebackDone));
    }

    /**
        * Test if the LSQRequest has been released, i.e. self-owned.
        * An LSQRequest manages itself when the resources on the LSQ are freed
        * but the translation is still going on and the LSQEntry was freed.
        */
    bool
    isReleased()
    {
        return flags.isSet(Flag::LSQEntryFreed) ||
            flags.isSet(Flag::Discarded);
    }

    bool
    isSplit() const
    {
        return flags.isSet(Flag::IsSplit);
    }

    bool
    needWBToRegister() const
    {
        return flags.isSet(Flag::WriteBackToRegister);
    }
    /** @} */
    virtual bool recvTimingResp(PacketPtr pkt) = 0;
    virtual bool sendPacketToCache() = 0;
    virtual void buildPackets() = 0;

    /**
        * Memory mapped IPR accesses
        */
    virtual Cycles handleLocalAccess(
            gem5::ThreadContext *thread, PacketPtr pkt) = 0;

    /**
        * Test if the request accesses a particular cache line.
        */
    virtual bool isCacheBlockHit(Addr blockAddr, Addr cacheBlockMask) = 0;

    /** Update the status to reflect that a packet was sent. */
    void
    packetSent()
    {
        flags.set(Flag::Sent);
    }
    /** Update the status to reflect that a packet was not sent.
        * When a packet fails to be sent, we mark the request as needing a
        * retry. Note that Retry flag is sticky.
        */
    void
    packetNotSent()
    {
        flags.set(Flag::Retry);
        flags.clear(Flag::Sent);
    }

    void sendFragmentToTranslation(int i);
    bool
    isComplete()
    {
        return flags.isSet(Flag::Complete);
    }

    bool
    isInTranslation()
    {
        return _state == State::Translation;
    }

    bool
    isTranslationComplete()
    {
        return flags.isSet(Flag::TranslationStarted) &&
                !isInTranslation();
    }

    bool
    isTranslationBlocked()
    {
        return _state == State::Translation &&
            flags.isSet(Flag::TranslationStarted) &&
            !flags.isSet(Flag::TranslationFinished);
    }

    bool
    isSent()
    {
        return flags.isSet(Flag::Sent);
    }

    bool
    isPartialFault()
    {
        return _state == State::PartialFault;
    }

    bool
    isMemAccessRequired()
    {
        return (_state == State::Request ||
                (isPartialFault() && isLoad()));
    }

    void
    setStateToFault()
    {
        setState(State::Fault);
    }

    /**
        * The LSQ entry is cleared
        */
    void
    freeLSQEntry()
    {
        release(Flag::LSQEntryFreed);
    }

    /**
        * The request is discarded (e.g. partial store-load forwarding)
        */
    void
    discard()
    {
        release(Flag::Discarded);
    }

    void
    packetReplied()
    {
        assert(_numOutstandingPackets > 0);
        _numOutstandingPackets--;
        if (_numOutstandingPackets == 0 && isReleased())
            delete this;
    }

    void
    writebackScheduled()
    {
        assert(!flags.isSet(Flag::WritebackScheduled));
        flags.set(Flag::WritebackScheduled);
    }

    void
    writebackDone()
    {
        flags.set(Flag::WritebackDone);
        /* If the lsq resources are already free */
        if (isReleased()) {
            delete this;
        }
    }

    void
    squashTranslation()
    {
        assert(numInTranslationFragments == 0);
        flags.set(Flag::TranslationSquashed);
        /* If we are on our own, self-destruct. */
        if (isReleased()) {
            delete this;
        }
    }

    void
    complete()
    {
        flags.set(Flag::Complete);
    }

    virtual std::string name() const { return "LSQRequest"; }
};
```

这个基类的构造函数倒是很简单，就是根据指令的信息进行一些 flag 的设置，然后将 ld/st queue 中对应 entry 的 request 设置成这个 request。

1. addrequest: 构造出底层的 request，将这个request插入到 _req 中。
2. forward：是和 storebuffer 相关的。
3. sendFragmentToTranslation:进行翻译，对指定的一个底层request进行翻译，调用的是相关体系结构 tlb 进行的翻译，这里指的是对单个的 request 进行翻译。

```cpp
void
LSQ::LSQRequest::sendFragmentToTranslation(int i)
{
    numInTranslationFragments++;
    _port.getMMUPtr()->translateTiming(req(i), _inst->thread->getTC(),
            this, isLoad() ? BaseMMU::Read : BaseMMU::Write);
}
```

实际的调用是:

```cpp
void
TLB::translateTiming(const RequestPtr &req, ThreadContext *tc,
                     BaseMMU::Translation *translation, BaseMMU::Mode mode)
{
    bool delayed;
    assert(translation);
    Fault fault = translate(req, tc, translation, mode, delayed);
    if (!delayed){
        translation->finish(fault, req, tc, mode);
    }
    else
        translation->markDelayed();
}

```

调用的 translate 是：

```cpp
Fault
TLB::translate(const RequestPtr &req, ThreadContext *tc,
               BaseMMU::Translation *translation, BaseMMU::Mode mode,
               bool &delayed)
{
    delayed = false;

    if (FullSystem) {
        PrivilegeMode pmode = getMemPriv(tc, mode);
        SATP satp = tc->readMiscReg(MISCREG_SATP);
        // 根据机器状态判断是不是只进行物理内存的访问
        if (pmode == PrivilegeMode::PRV_M || satp.mode == AddrXlateMode::BARE)
            req->setFlags(Request::PHYSICAL);

        Fault fault;
        if (req->getFlags() & Request::PHYSICAL) {
            /**
             * we simply set the virtual address to physical address
             */
            req->setPaddr(req->getVaddr());
            fault = NoFault;
        } else {
            // 如果不是直接的物理内存访问，需要进行翻译
            fault = doTranslate(req, tc, translation, mode, delayed);
        }

        // according to the RISC-V tests, negative physical addresses trigger
        // an illegal address exception.
        // TODO where is that written in the manual?
        if (!delayed && fault == NoFault && bits(req->getPaddr(), 63)) {
            ExceptionCode code;
            if (mode == BaseMMU::Read)
                code = ExceptionCode::LOAD_ACCESS;
            else if (mode == BaseMMU::Write)
                code = ExceptionCode::STORE_ACCESS;
            else
                code = ExceptionCode::INST_ACCESS;
            fault = std::make_shared<AddressFault>(req->getVaddr(), code);
        }

        if (!delayed && fault == NoFault) {
            pma->check(req);

            // do pmp check if any checking condition is met.
            // mainFault will be NoFault if pmp checks are
            // passed, otherwise an address fault will be returned.
            fault = pmp->pmpCheck(req, mode, pmode, tc);
        }

        return fault;
    } else {
        // not in full system
    }
}

```

### dotranslate

```cpp
Fault
TLB::doTranslate(const RequestPtr &req, ThreadContext *tc,
                 BaseMMU::Translation *translation, BaseMMU::Mode mode,
                 bool &delayed)
{
    delayed = false;
    // 设置虚拟地址
    Addr vaddr = Addr(sext<VADDR_BITS>(req->getVaddr()));
    SATP satp = tc->readMiscReg(MISCREG_SATP);
    Addr vaddr_trace = (vaddr >> (PageShift + L2TLB_BLK_OFFSET)) << (PageShift + L2TLB_BLK_OFFSET);
    if (((vaddr_trace != lastVaddr) || (req->getPC() != lastPc)) &&
        is_dtlb) {
        traceFlag = true;
        lastVaddr = vaddr_trace;
        lastPc = req->getPC();
    } else {
        traceFlag = false;
    }

    TlbEntry *e[6] = {nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};
    TlbEntry *forward_pre[6] = {nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};
    TlbEntry *back_pre[6] = {nullptr, nullptr, nullptr, nullptr, nullptr, nullptr};
    e[0] = lookup(vaddr, satp.asid, mode, false, true);
    Addr paddr = 0;
    Fault fault = NoFault;
    Fault fault_return = NoFault;
    Fault forward_pre_fault;
    Fault back_pre_fault;
    STATUS status = tc->readMiscReg(MISCREG_STATUS);
    PrivilegeMode pmode = getMemPriv(tc, mode);

    TLB *l2tlb;
    if (isStage2)
        l2tlb = this;
    else
        l2tlb = static_cast<TLB *>(nextLevel());

    assert(l2tlb != nullptr);

    uint64_t remove_unused_forward_pre = l2tlb->removeNoUseForwardPre;
    uint64_t all_forward_pre_num = l2tlb->allForwardPre;
    uint64_t all_used_num = l2tlb->allUsed / l2tlbLineSize;
    uint64_t all_used_forward_pre_num = l2tlb->forwardUsedPre;
    auto precision = (double)(all_forward_pre_num - remove_unused_forward_pre) / (all_forward_pre_num + 1);

    auto recall = (double)all_used_forward_pre_num / (all_used_num + 1);
    RequestPtr pre_req = req;


    Addr forward_pre_vaddr = vaddr + (l2tlbLineSize << PageShift);
    Addr forward_pre_block = (forward_pre_vaddr >> (PageShift + L2TLB_BLK_OFFSET)) << (PageShift + L2TLB_BLK_OFFSET);
    Addr vaddr_block = (vaddr >> (PageShift + L2TLB_BLK_OFFSET)) << (PageShift + L2TLB_BLK_OFFSET);
    Addr back_pre_vaddr = vaddr - vaddr + (l2tlbLineSize << PageShift);
    Addr back_pre_block = (back_pre_vaddr >> (PageShift + L2TLB_BLK_OFFSET)) << (PageShift + L2TLB_BLK_OFFSET);

    l2tlb->lookupForwardPre(vaddr_block, satp.asid, false);
    TlbEntry *pre_forward = l2tlb->lookupForwardPre(forward_pre_block, satp.asid, true);

    l2tlb->lookupBackPre(vaddr_block, satp.asid, false);
    TlbEntry *pre_back = l2tlb->lookupBackPre(back_pre_block, satp.asid, true);
    backPrePrecision = checkPrePrecision(l2tlb->removeNoUseBackPre, l2tlb->usedBackPre);
    forwardPrePrecision = checkPrePrecision(l2tlb->removeNoUseForwardPre, l2tlb->forwardUsedPre);

    for (int i_e = 1; i_e < 6; i_e++) {
        if (!e[0])
            e[i_e] = l2tlb->lookupL2TLB(vaddr, satp.asid, mode, false, i_e, true);

        forward_pre[i_e] = l2tlb->lookupL2TLB(forward_pre_block, satp.asid, mode, true, i_e, true);
        back_pre[i_e] = l2tlb->lookupL2TLB(back_pre_block, satp.asid, mode, true, i_e, true);
    }
    bool return_flag = false;


    if (!e[0]) {  // look up l2tlb
        if (e[3]) {  // if hit in l3tlb
            DPRINTF(TLBVerbosel2, "hit in l2TLB l3\n");
            fault = L2TLBCheck(e[3]->pte, L2L3CheckLevel, status, pmode, vaddr, mode, req, false, false);
            if (hitInSp) {
                e[0] = e[3];
                if (fault == NoFault) {
                    paddr = e[0]->paddr << PageShift | (vaddr & mask(e[0]->logBytes));
                    DPRINTF(TLBVerbosel2, "vaddr %#x,paddr %#x,pc %#x\n", vaddr, paddr, req->getPC());
                    walker->doL2TLBHitSchedule(req, tc, translation, mode, paddr, *e[3]);
                    DPRINTF(TLBVerbosel2, "finish Schedule\n");
                    delayed = true;
                    if ((forward_pre_block != vaddr_block) && (!forward_pre[3]) && openForwardPre && (!pre_forward)) {
                        if (forward_pre[2] || forward_pre[5]) {
                            sendPreHitOnHitRequest(forward_pre[5], forward_pre[2], req, forward_pre_block, satp.asid,
                                                   true, L2L2CheckLevel, status, pmode, mode, tc, translation);
                        } else {
                            if (forward_pre[1] || forward_pre[4]) {
                                sendPreHitOnHitRequest(forward_pre[4], forward_pre[1], req, forward_pre_block,
                                                       satp.asid, true, L2L1CheckLevel, status, pmode, mode, tc,
                                                       translation);
                            }
                        }
                    }
                    if ((back_pre_block != vaddr_block) && (!back_pre[3]) && openBackPre && (!pre_back)) {
                        if (back_pre[2] || back_pre[5]) {
                            sendPreHitOnHitRequest(back_pre[5], back_pre[2], req, back_pre_block, satp.asid, false,
                                                   L2L2CheckLevel, status, pmode, mode, tc, translation);
                        }
                    }
                    if (traceFlag)
                        DPRINTF(TLBtrace, "tlb hit in vaddr %#x pc %#x\n", vaddr_trace, req->getPC());
                    return fault;
                }
            } else {
                panic("wrong in L2TLB\n");
            }

        } else if (e[5]) {  // hit in sp l2
            DPRINTF(TLBVerbosel2, "hit in l2 tlb l5\n");
            fault = L2TLBCheck(e[5]->pte, L2L2CheckLevel, status, pmode, vaddr, mode, req, false, false);
            if (hitInSp)
                e[0] = e[5];
            auto [return_flag, fault_return] =
                L2TLBSendRequest(fault, e[5], req, tc, translation, mode, vaddr, delayed, 0);
            if (return_flag)
                return fault_return;
        } else if (e[4]) {  // hit in sp l1
            DPRINTF(TLBVerbosel2, "hit in l2 tlb l4\n");
            fault = L2TLBCheck(e[4]->pte, L2L1CheckLevel, status, pmode, vaddr, mode, req, false, false);
            if (hitInSp)
                e[0] = e[4];
            auto [return_flag, fault_return] =
                L2TLBSendRequest(fault, e[4], req, tc, translation, mode, vaddr, delayed, 1);
            if (return_flag)
                return fault_return;
        } else if (e[2]) {
            DPRINTF(TLBVerbosel2, "hit in l2 tlb l2\n");
            fault = L2TLBCheck(e[2]->pte, L2L2CheckLevel, status, pmode, vaddr, mode, req, false, false);
            if (hitInSp)
                e[0] = e[2];
            auto [return_flag, fault_return] =
                L2TLBSendRequest(fault, e[2], req, tc, translation, mode, vaddr, delayed, 0);
            if (return_flag)
                return fault_return;
        } else if (e[1]) {
            DPRINTF(TLBVerbosel2, "hit in l2 tlb l1\n");
            fault = L2TLBCheck(e[1]->pte, L2L1CheckLevel, status, pmode, vaddr, mode, req, false, false);
            if (hitInSp)
                e[0] = e[1];
            auto [return_flag, fault_return] =
                L2TLBSendRequest(fault, e[1], req, tc, translation, mode, vaddr, delayed, 1);
            if (return_flag)
                return fault_return;
        } else {
            DPRINTF(TLB, "miss in l1 tlb + l2 tlb\n");
            DPRINTF(TLBGPre, "pre_req %d vaddr %#x req_vaddr %#x pc %#x\n", req->get_forward_pre_tlb(), vaddr,
                    req->getVaddr(), req->getPC());

            if (traceFlag)
                DPRINTF(TLBtrace, "tlb miss vaddr %#x pc %#x\n", vaddr_trace, req->getPC());
            fault = walker->start(0, tc, translation, req, mode, false, false, 2, false, 0);
            DPRINTF(TLB, "finish start\n");
            if (translation != nullptr || fault != NoFault) {
                // This gets ignored in atomic mode.
                delayed = true;
                return fault;
            }
            e[0] = lookup(vaddr, satp.asid, mode, false, true);
            assert(e[0] != nullptr);
        }
    }
    if (!e[0])
        e[0] = lookup(vaddr, satp.asid, mode, false, true);
    assert(e[0] != nullptr);

    status = tc->readMiscReg(MISCREG_STATUS);
    pmode = getMemPriv(tc, mode);
    if (mode == BaseMMU::Write && !e[0]->pte.d) {
        fault = createPagefault(vaddr, mode);
    }

    if (fault == NoFault) {
        DPRINTF(TLB, "final checkpermission\n");
        DPRINTF(TLB, "translate(vpn=%#x, asid=%#x): %#x pc %#x mode %i pte.d %\n", vaddr, satp.asid, paddr,
                req->getPC(), mode, e[0]->pte.d);
        fault = checkPermissions(status, pmode, vaddr, mode, e[0]->pte);
    }


    if (fault != NoFault) {
        // if we want to write and it isn't writable, do a page table walk
        // again to update the dirty flag.
        //change update a/d not need to do a pagetable walker
        DPRINTF(TLB, "raise pf pc%#x vaddr %#x\n", req->getPC(), vaddr);
        DPRINTF(TLBVerbose3, "mode %i pte.d %d pte.w %d pte.r %d pte.x %d pte.u %d\n", mode, e[0]->pte.d, e[0]->pte.w,
                e[0]->pte.r, e[0]->pte.x, e[0]->pte.u);
        DPRINTF(TLBVerbose3, "paddr %#x ppn %#x\n", e[0]->paddr, e[0]->pte.ppn);
        if (traceFlag)
            DPRINTF(TLBtrace, "tlb hit in l1 but pf vaddr %#x,pc%#x\n", vaddr_trace, req->getPC());
        return fault;
    }
    assert(e[0] != nullptr);
    paddr = e[0]->paddr << PageShift | (vaddr & mask(e[0]->logBytes));

    DPRINTF(TLBVerbosel2, "translate(vpn=%#x, asid=%#x): %#x pc%#x\n", vaddr,
            satp.asid, paddr, req->getPC());
    req->setPaddr(paddr);

    if (e[0]) {
        // same block
        if (traceFlag)
            DPRINTF(TLBtrace, "tlb hit in l1 vaddr %#x,pc%#x\n", vaddr_trace,
                    req->getPC());
        if ((forward_pre_block != vaddr_block) && (!forward_pre[3]) && openForwardPre && (!pre_forward)) {
            if (forward_pre[2] || forward_pre[5]) {
                sendPreHitOnHitRequest(forward_pre[5], forward_pre[2], req, forward_pre_block, satp.asid, true,
                                       L2L2CheckLevel, status, pmode, mode, tc, translation);
            } else {
                if (forward_pre[4] || forward_pre[1]) {
                    sendPreHitOnHitRequest(forward_pre[4], forward_pre[1], req, forward_pre_block, satp.asid, true,
                                           L2L1CheckLevel, status, pmode, mode, tc, translation);
                }
            }
        }
        if ((back_pre_block != vaddr_block) && (!back_pre[3]) && openBackPre && (!pre_back)) {
            if (back_pre[2] || back_pre[5]) {
                sendPreHitOnHitRequest(back_pre[5], back_pre[2], req, back_pre_block, satp.asid, false, L2L2CheckLevel,
                                       status, pmode, mode, tc, translation);
            }
        }
    }

    return NoFault;
}

```

在上面所有都完成时候如果没有产生延迟的话， lsqunit 会执行 finish 的操作，而这个 finish 的操作是各个 LSQUnit 的子类实现的。

### 定义的纯虚函数

1. markAsStaleTranslation:标记什么时候被认为翻译终止
2. initiateTranslation:标记翻译开始
3. recvTimingResp:接受到返回的请求
4. sendPacketToCache:向 cache 发送请求
5. buildPackets：构建底层通信使用的数据包
6. handleLocalAccess:暂时不明确
7. isCacheBlockHit:某个 cache 行命中，暂时不明确
8. finish: 完成地址翻译，来自 mmu translation

## SingleDataRequest

1. finish:主要就是表示传输完成，对状态进行一些改变。
2. initiateTranslation: build 出一个底层的 request，并开始地址翻译，如果经过 addReq 的判断不需要生成 request，则 setMemAccPredicate 为false。
3. markAsStaleTranslation: 通过简单的判断手段设置 hasStaleTranslation 为 true.
4. recvTimingResp: 直接调用 lsq 的 completeDataAccess.
5. buildPackets:就是 build 出一个底层传输的 packet。
6. isCacheBlockHit handleLocalAccess:组合配对的操作。
7. sendPacketToCache：像获取数据的开始。

signle 中进行操作的时候进行了大部分 == 1 的检查，实际上想表示的是这个请求最多想维护一个包。

## UnsquashableDirectRequest

硬件事务内存和取 ITLB 的时候使用，是不可暂停的。访问的时候不需要地址转换，直接设置物理地址的访问。

## SplitDataRequest

主要维护的是跨 cache 的地址访问，因此其可能向内存发出多个请求包。

1. isCacheBlockHit handleLocalAccess:isCacheBlockHit 无非是对其中管理的多个 request 进行判断。
2. sendPacketToCache: 将多个包发送到 cache。

```cpp
bool
LSQ::SplitDataRequest::sendPacketToCache()
{
    /* Try to send the packets. */
    bool bank_conflict = false;
    while (numReceivedPackets + _numOutstandingPackets < _packets.size()) {
        bool success = lsqUnit()->trySendPacket(isLoad(), _packets.at(numReceivedPackets + _numOutstandingPackets),
                                                bank_conflict);
        if (success) {
            _numOutstandingPackets++;
        } else {
            // 一旦有阻塞的就暂停发送
            break;
        }
    }
    // 一旦有不成功的就要下个周期重新试
    if (bank_conflict) {
        lsqUnit()->bankConflictReplaySchedule();
    }

    // 全部成功送出去返回 true
    if (_numOutstandingPackets == _packets.size()) {
        return true;
    }
    return false;
}
```

3. buildPackets:创建出多个包，无非就是 load 的时候产生一个 main packet。
4. recvTimingResp: 无非就是合并多个包的状态。
5. markAsStaleTranslation: 没有任何与其他的不同。
6. finish:无非就是多个产生 translation 的包。
7. initiateTranslation: 无非就是管理多个翻译。

## SbufferRequest

委托对 store buffer 的请求。
