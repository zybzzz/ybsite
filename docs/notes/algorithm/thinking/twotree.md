## 两个树一起搜

[Two Sum BSTs](https://leetcode.cn/problems/two-sum-bsts/description/)

这个问题实际是两个树上搜出一个和的问题。

1. 暴力：一个暴力搜完 hash set，另一个暴力搜完看看 tgt - val 在不在 hash 中。
2. 暴力：如果一个树特别小，另一个树特别大，对着小的树一个个暴力，大的树做搜索，因为是二叉搜索树，所以只需要 log 复杂度，总体为 nlogm。
3. 模拟两树之和，设计树的迭代器。一个指向树的最大，一个指向另一个的最小，然后就和两树之和一样。
