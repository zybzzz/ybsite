# xiangshan decode

主要记录 xiangshan decode.

## checkSignalsAndUpdate

1. 检查来自 commit 的清空
2. 检查后阶段的阻塞
3. 如果当前处于阻塞状态解除阻塞
4. 清空完成转 running

## decode

除了被清空的指令之外都想 rename 阶段输送了。很多情况都在处理和分支预测相关的情况。