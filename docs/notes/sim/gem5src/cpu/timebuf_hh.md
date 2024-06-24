# timebuf.hh 解析

TimeBuffer 封装了对过去某个时间点和对未来某个时间点的访问能力。即能够访问 $[past, future]$ 时间区间内数据的能力。

TimeBuffer 是一个模板，用来实例化这个模板的类就是 TimeBuffer 中存储的对象。TimeBuffer 实际上是一个循环的数组。内置的 `valid` 函数会在操作的时候对范围进行判断。`index` 数组存放的是指向各个对象的指针。`base` 指针在初始化的时候数值默认为0,其实初始化的时候 `base` 在哪里都无所谓，反正整个 buffer 此时都是空的，比较重要的是在 buffer 中有数据了以后，`base` 的位置不能随便变动。为了获取 TimeBuffer 中的数据，往往都是需要通过 `wire` 进行访问，wire 指定了相对于 `base` 作为起始点的数据访问，加入 `wire` 传入的 index 参数是 -2,那么 `wire` 每次获取到的就是当前 `base` - 2 的数据。

`advance` 进行的操作有两个，**首先将 `base` 指针向前移动一格，注意每次 `base` 只向前移动一个，不管在任何参数下都是如此，然后是基于 `base` 指针当前的位置将 `+future` 所在位置的指针进行清空，注意只是对这个位置进行清空，而不是将 `base` 设置到这个位置**。`calculateVectorIndex` 则是基于当前 `base` 的位置返回 `+idx` 的坐标，注意这里传入的 `idx` 可能是正的也可能是负的，表示能够对过去和未来位置进行访问。

使用 `access` 函数对基于 base 位置的给定 index 进行访问，index 可以是正数也可以是负数，代表未来和过去。`wire` 连线实际上就是基于 `access` 来实现的。

TimeBuffer 往往都是对延时进行模拟，对于给定的延时 $t_1$，TimeBuffer 的必须要有 $past \geq t_1$，不然数据还没读到，就已经被 `advance` 进行的操作擦除了。暂时还没有看到在 TimeBuffer 进行对于 `future` 方向的访问，但是其跟 `past` 一样，对于延迟的设定一定要在 $\leq future$ 这样的范围内，不然同样会被 `advance` 操作进行擦除。
