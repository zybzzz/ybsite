# xiangshan fetch

主要记录 xiangshan 的取指阶段。

## checkSignalsAndUpdate

和先前的阶段一样，都是检查信号然后更新状态，并返回状态是否更新。

1. 更新 decode 是否 stall。
2. 检查 commit 阶段是否造成了清空：
   1. 如果产生了清空信号，清空 fetch，根据不同的清空原因告知分支预测器 squash。
   2. 如果没有产生清空信号，就正常提交，同样的更新分支预测器。
3. 分析来自 decode 阶段的清空。
4. 检查是否阻塞，如果阻塞就 blocked。
5. 没有检查到阻塞的话就将状态变成 running。

## fetch

地址翻译，翻译结束的时候回调取指。和分支预测单元的设计产生大量的相关。

地址翻译的通信都是走 mmu，数据相关的才是走 cache。

