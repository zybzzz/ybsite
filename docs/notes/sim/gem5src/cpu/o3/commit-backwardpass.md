# commit 阶段前向传递信息的发生时机以及信息内容

这篇文章总结 commit 阶段向前传递信息的发生时机,即 CommitComm 中数据设置的时机。

## pc

1. Commit::commit中处理正常指令squash时设置，值为 `fromIEW->pc[tid]`。（分支预测错误）
2. Commit::squashAll中设置，值为 `pc[tid]`。（异常等）

## mispredictInst

1. Commit::commit中处理正常指令squash时设置，值为 `fromIEW->mispredictInst[tid]`。（分支预测错误）
2. Commit::squashAll中设置，值为 `NULL`。（异常等，表示这种并不由某一个预测错误引起）

## squashInst

这个值代表着非预测错误造成 squash 的指令。

1. Commit::commit中处理正常指令squash时设置，值为 `rob->findInst(tid, squashed_inst);`。
2. Commit::squashAll中设置，值为 `NULL`。
3. Commit::squashFromSquashAfter中设置，值为`squashAfterInst[tid]`。

## strictlyOrderedLoad

1. Commit::commitHead中设置，在指令还没执行情况下符合某些条件的时候设置，值为`head_inst`。

## nonSpecSeqNum

1. Commit::commitHead中设置，在指令还没执行情况下符合某些条件的时候设置，值为`head_inst->seqNum`。

## doneSeqNum

1. Commit::squashAll中设置，值为`rob->isEmpty(tid) ? lastCommitedSeqNum[tid] : rob->readHeadInst(tid)->seqNum - 1`。
2. Commit::commit中处理正常指令squash时设置，值为 `squashed_inst`。
3. Commit::commitInsts中ROB头部指令提交成功设置，值为`head_inst->seqNum`。

## freeROBEntries

1. Commit::startupStage中设置，值为`rob->numFreeEntries(tid)`。
2. Commit::commit中设置，如果本周期对ROB产生了修改，则会重新计算这个值，值为`rob->numFreeEntries(tid)`。

## squash

1. Commit::commit中处理正常指令squash时设置，值为 `true`。
2. Commit::squashAll中设置，值为 `true`。

## robSquashing

1. Commit::commit中处理正常指令squash时设置，值为 `true`。
2. Commit::squashAll中设置，值为 `true`。
3. Commit::tick中处理之前未完成的squash时设置，值为 `true`。

## usedROB

和 freeROBEntries 的情况设置相同，每次都被设置为 true。

## emptyROB

1. 在startup的时候设置。
2. Commit::commit最后符合`checkEmptyROB[tid] && rob->isEmpty(tid) && !iewStage->hasStoresToWB(tid) && !committedStores[tid]`设置为true。

## branchTaken

1. Commit::commit中处理正常指令squash时设置，值为 `fromIEW->branchTaken[tid]`。
2. Commit::commit中处理正常指令squash时，该情况是由预测错误导致，且相关的分支指令为无条件分支，设置为`true`。

## interruptPending

1. Commit::propagateInterrupt中检测到中断时候设置为`true`。

## clearInterrupt

1. Commit::commitInsts中第一步就是处理中断，处理完中断或者暂时推迟中断都将这个值设置为`true`。

## strictlyOrdered

和strictlyOrderedLoad同步设置。

1. Commit::commitHead中设置，在指令还没执行情况下符合某些条件的时候设置，值为`true`。
