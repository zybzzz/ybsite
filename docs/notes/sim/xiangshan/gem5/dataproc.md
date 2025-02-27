# gem5 data proc

主要记录 gem5 data proc 这个仓库的信息。

## 过程

主要是使用 `batch.py` 根据不同的要求先把所有的统计信息拿出来，然后转成 csv。这个csv再被后续的流程使用。

## 算分

算分，或者说是指代基于权重的统计数据处理，本质是加载上一步保存的 csv 文件，然后读取权重 json，然后根据权重加权算分，过程没有这么复杂。

这里记录几个关键的返回值结构：

1. weight_metrics_df.value: 所有 benchmark 对各种统计数据加权想加之后的结果，这是一个列表。
2. weight_metrics_df.colums：同上面对应，这是一个字符串的列表，代表对上面的值对应的属性。
3. wl_df：单个 benchmark 的原始数据，是从 `batch.py` 中的 csv 结果切出来的一部分。
4. decomposed: wl_df 中所有的 workload 乘以权重之后得到的结果，其结构和 wl_df 是一样的。
5. vec_weight: 从 json 文件中出来的权重，来自 deterload.
