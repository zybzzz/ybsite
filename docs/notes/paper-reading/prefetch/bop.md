# best offset prefetcher

考虑及时性的 offset prefetcher。

## 动机

nextline 可能是不及时的。

迟到的问题就是延时不能被完全掩盖，资源争抢这些，MSHR占据这些就不好说了。主要还是应该在 MSHR 够的情况下进行预取，不然会影响处理器执行时候本身的 MLP。

## 设计

触发时机：l2 miss 或者 prefetch hit 到了 l2. l2 miss 现在 miss 了，希望将来不要 miss。fill，虽然当前的是 prefetch，但是当前的 prefetch 是很早之前的一个 miss 产生的，因此我还是要往下预取。

不同页可以一起学习，但是跨页的预取不会发送。等于处理了不同的 stream。

RR 入队：只能发生在 prefetch fill 的时候。

流量控制：分数达到 1 分以上才能进行预取。否则对于每次 fill，直接插入表。


```cpp
for (each l2 miss and l2 prefetch fill)
    di = nextdinoffsetlist()
    if(current_addr - di in RR)
        score[di]++;

if(scoremax or round to the max)
    select the biggest score di

D = select di
```

解决太早到达的问题：
1. 本身就是在页内的预取，至少保证了 offset 不会太大，不会太早被取到。
2. 控制 RR 的大小，时间离的远的被淘汰了，太早的预取不会发生。
