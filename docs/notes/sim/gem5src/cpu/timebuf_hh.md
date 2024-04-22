# timebuf.hh 解析

TimeBuffer 封装了对过去某个时间点和对未来某个时间点的访问能力。即能够访问 $[past, future]$ 时间区间内数据的能力。

TimeBuffer 是一个模板，用来实例化这个模板的类就是 TimeBuffer 中存储的对象。TimeBuffer 实际上是一个循环的数组。内置的 `valid` 函数会在操作的时候对范围进行判断。`index` 数组存放的是指向各个对象的指针。`advance` 表示前进到 `future` 这个时间点，到 future 这个点指向的对象被清空并重新创建，在这之前的数据变成 past。

使用 `access` 函数对基于 base 位置的给定 index 进行访问，index 可以是正数也可以是负数，代表未来和过去。

封装了内部类 `wire`， 总是对当前base的某个index进行访问。