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