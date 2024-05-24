# timebuf.hh 解析

TimeBuffer 封装了对过去某个时间点和对未来某个时间点的访问能力。即能够访问 $[past, future]$ 时间区间内数据的能力。

TimeBuffer 是一个模板，用来实例化这个模板的类就是 TimeBuffer 中存储的对象。TimeBuffer 实际上是一个循环的数组。内置的 `valid` 函数会在操作的时候对范围进行判断。`index` 数组存放的是指向各个对象的指针。`base` 指针在初始化的时候数值默认为0,其实初始化的时候 `base` 在哪里都无所谓，反正整个 buffer 此时都是空的，比较重要的是在 buffer 中有数据了以后，`base` 的位置不能随便变动。

`advance` 进行的操作有两个，首先将 `base` 指针向前移动一格，然后是基于 `base` 指针当前的位置将 `+future` 所在位置的指针进行清空。`calculateVectorIndex` 则是基于当前 `base` 的位置返回 `+idx` 的坐标，注意这里传入的 `idx` 可能是正的也可能是负的，表示能够对过去和未来位置进行访问。

使用 `access` 函数对基于 base 位置的给定 index 进行访问，index 可以是正数也可以是负数，代表未来和过去。

封装了内部类 `wire`， 总是对当前base的某个index进行访问。