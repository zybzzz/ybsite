# LL/SC 

是在内存层面完成，估计是写入不成功会返回 fault，具体是在 abstractmem 中实现. atomic 也是内存直接支持的 atomic，是内存层面实现的，具体看 pushmeminst 中 atomic 的实现。

## 处理

LL 当正常 load 处理，sc 和 atomic 当 nospec 的 store 处理。 