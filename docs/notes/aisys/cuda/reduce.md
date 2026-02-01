# 规约

规约看层次，看在哪个层次上的规约。

1. warp 内，使用 cuda 提供的原语就行了，注意 register bank conflict.
2. sm 上的多 warp，在 shared memory 上做。
3. 多 sm 之间，DPM 或者 L2 上做。
