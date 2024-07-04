# rename 阶段

rename 主要维护了几个状态，利用这些状态机的状态帮助 rename 阶段进行处理。

## rename 状态机状态

rename 状态机维护了这几个状态：

```cpp
enum ThreadStatus
{
    Running,
    Idle,
    StartSquash,
    Squashing,
    Blocked,
    Unblocking,
    SerializeStall
};
```

对这几个状态的解释如下：

1. Running：正常运行状态，指令是从 decode 阶段获取的。
2. Idle：闲置状态，这个状态就只是在初始化构造函数的时候出现。
3. StartSquash：这个状态没有使用过。
4. Squashing：正在处理squash。
5. Blocked：因为资源原因和序列化原因阻塞。
6. Unblocking：阻塞状态解除，同正常运行状态没区别，只不过指令从skidbuffer中获取。
7. SerializeStall：一种特殊的block状态，主要辅助seriasl进行处理。

## rename 状态转换

checkSignalsAndUpdate 中的状态转换：

- 不依赖于当前状态的状态转换：
  1. `fromCommit->commitInfo[tid].squash` 时，设置状态为 Squashing，如果传过来的指令队列中(fromdecode->inst)还含有序列号小于清空序列号的指令，即不会被清空的指令，另外设置 resumeSerialize 为 true。
  2. `checkStall(tid)` 时，如果当前状态(!= Blocked && != Blocked SerializeStall)，将状态设置为 Blocked；如果是 Blocked 或 SerializeStall 保持状态不变。

- 依赖于当前状态的状态转换：(运行到此处表明 commit 没有发来清空信号，后端的流水线资源充足、不存在同步问题不会导致阻塞)

  3. 当前状态为 Blocked 时，转为 Unblocking，更进一步的，如果 skidbuffer 为空，转为 Running。
  4. 当前状态为 Squashing 时：
     - resumeSerialize 被设置，转为 SerializeStall。
     - 否则转为 Running。
  5. 当前状态为 SerializeStall，转为 Unblocking。取出需要同步的指令(`DynInstPtr serial_inst = serializeInst[tid]`)，清除其 SerializeBefore 标志(`serial_inst->clearSerializeBefore()`)，将这条指令插入到 skidbuffer 或者 inst 中(取决于skidbuffer是否为空)，设置 `serializeInst[tid]`。


Rename::rename 中的状态转换：

6. 当前状态为 SerializeStall：如果 resumeSerialize 被设置，resumeSerialize 设置为 false，把前阶段传过来的指令存到 skidbuffer中。不返回。
7. 当前状态为 Running 、 Idle 、 Unblocking 都能进行后续的寄存器重命名：
   1. 状态为 Unblocking，指令来源为 skidbuffer，否则来源为 inst。
   2. 资源不够，调用 block(tid)， 向 Blocked 状态转换。返回。
   3. 之前设置过 `serializeOnNextInst[tid]`：`emptyROB[tid] && instsInProgress[tid] == 0` 等于说序列化已经不再需要，设置 `serializeOnNextInst[tid] = false`；如果 `!insts_to_rename.empty()`，表示有指令能够承载序列化，对头部指令设置 `insts_to_rename.front()->setSerializeBefore()`；否则维持现状，不返回。
   4. 不断的进行重命名。如果某次循环开始资源不够，直接返回。资源够的情况下从头部取出指令：
      - `inst->isSerializeBefore() && !inst->isSerializeHandled()`：这条指令是序列化的，但是还没处理。`!inst->isTempSerializeBefore()` 如果这条指令本身就是序列化的，不是由 SerialAfter 赋值给他的，将这个序列化设置为已经处理(`inst->setSerializeHandled()`)，否则不动。将状态设置为 SerializeStall，serializeInst 设置为当前指令(`serializeInst[tid] = inst`)。设置 `blockThisCycle` 为 true。break。
      - `(inst->isStoreConditional() || inst->isSerializeAfter()) && !inst->isSerializeHandled()`：这条指令是 SerializeAfter 的，但是还没处理，将这条指令设置为已处理(`inst->setSerializeHandled()`)，如果当前取指队列的头部有指令，直接将指令设置成 SerializeBefore， 否则设置 `serializeOnNextInst[tid]` 为 true。
      - 源寄存器、目的寄存器进行寄存器重命名。
      - blockThisCycle 如果被设置，进行 block(tid)。

以上为所有的状态转换。

## 考虑 commit 阶段 squash 发生，先前正在正常执行

状态设置为 Squashing。随后

```cpp
for (int i=0; i<fromDecode->size; i++) {
    if (fromDecode->insts[i]->threadNumber == tid &&
        fromDecode->insts[i]->seqNum > squash_seq_num) {
        fromDecode->insts[i]->setSquashed();
        wroteToTimeBuffer = true;
    }
}
```

对前阶段传过来的指令进行判断，对属于当前线程的指令序列号判断进行设置，然后清空inst和skidbuffer，恢复重命名历史。进入Rename::rename，由于当前状态是squash，什么都不能做。进入下一轮 tick，假如没有任何情况，转换成 Running，对正常接收到的指令进行重命名。

## 正常 running 执行碰到序列化

假设在 renameInst 中遇到情况 `inst->isSerializeBefore() && !inst->isSerializeHandled()`，且这条指令本身是后来被设置的 SerializeBefore。状态转换成 SerializeStall，`serializeInst[tid] = inst`，剩余指令转到 skidbuffer，先前重命名的指令已经被传到下一个阶段。进入第二个 tick，checkSignalsAndUpdate 中取出上个周期保存的数据 `DynInstPtr serial_inst = serializeInst[tid];`，状态转换成 Unblocking，将SerializeBefore标记清除掉，将这条指令插入 skidbuffer 如果其非空，否则插入 insts。`serializeInst[tid]` 设置为 null。随后所有条件都被排除，正常重命名。重命名完成之后，在Rename::rename中，会进行 `status_change = unblock(tid) || status_change || blockThisCycle;`，这之中会调用 `unblock(tid)`，会尝试将状态转换成 running，如果转换不了仍然保持 unblock 状态。

**对于unblock状态，每次renameInsts执行完成之后，都会尝试将状态转换成running。对于renameInsts，其执行过程中会有多个判断，对于出现资源不够或者一个周期处理不完的情况，都尝试通过block将状态转换成block。**

## 正常running 执行遇到 serializeAfter

遇到 serializeAfter 的情况是在 renameInsts中，在 `(inst->isStoreConditional() || inst->isSerializeAfter()) && !inst->isSerializeHandled()` 情况下，将本条指令设置为序列化已处理 `inst->setSerializeHandled()`，本条指令在本周期并不会导致block，这条 serializeAfter 会被传送到下个阶段，随后有 `serializeAfter(insts_to_rename, tid)`，即尝试把这条指令的下一条指令变成 SerializeBefore，等于说是用下一条指令的 SerializeBefore 实现本条指令的 SerializeAfter，实现语义上的相等。`serializeAfter(insts_to_rename, tid)` 函数如下：

```cpp
void
Rename::serializeAfter(InstQueue &inst_list, ThreadID tid)
{
    // 如果指令序列为空，就设置一个标记
    // 等下次指令序列不空的时候，将第一条标记设置为 SerializeBefore
    if (inst_list.empty()) {
        serializeOnNextInst[tid] = true;
        return;
    }

    // 如果指令序列本身就不为空，直接设置就行了
    inst_list.front()->setSerializeBefore();
}
```

这个函数实际上就是实现了将下一条指令设置成 SerializeBefore。

## 受 resumeSerialize 影响的情况

只有状态在 SerializeStall 时，遇到 commit 阶段传送过来的 squash 的时候才会触发，在调用 Rename::squash 的时候，如果有 `serializeInst[tid]->seqNum <= squash_seq_num`(这个情况应该很少出现)，则 resumeSerialize 被设置为 true，状态转成 squashing，清空 insts 和 skidBuffer。进入下一个时钟周期，一切都正常的情况下状态转 SerializeStall， 进入 Rename::rename，resumeSerialize 被设置，将这个值设置为 false，将指令转入skidbuffer。再到下个时钟周期，状态转 Unblocking 随后进行寄存器重命名。

**``serializeInst[tid]->seqNum <= squash_seq_num``我认为几乎不可能发生，对于serializeInst的指令，执行到就被堵住了，他自身和后续的指令都不会向下个阶段传递了，因此后续阶段产生的squash_seq_num必然小于这个线程的序列号。**

## 与前阶段的通信

这个阶段主要有两个与前阶段的通信变量，分别是 renameBlock(true本阶段阻塞) 与 renameUnBlock(true本阶段不阻塞)，默认都为 false。

对于 renameBlock：

1. block时候，符合一定的条件设置。

对于 renameUnBlock：

1. 在上面的1 renameBlock 被设置的时候哦，renameUnBlock 变成 false。
2. unblock中状态成功转换成 running 的时候设置为 true。
3. squash如果状态为 Blocked、Unblocking、SerializeStall 的时候设置。
4. Rename::rename中，调用了 block 的情况下，紧跟着将 renameUnBlock 设置成 false。
