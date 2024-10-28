# stats 统计变量 

简单的讲讲统计变量。

## scalar

最基本的标量，加减。

## vector 

多个标量组成的向量，显然对于向量中的每个元素都是可以加减的。

## value

就是简简单单的存储一个数值，可以是返回值等等。

## 2dvector 

二维向量，同向量一样，无非就是一个二维形式的表格能用来加减。

## Distribution

直方图，传入的参数是 `(left, right, bucket_num)`，left right 表明了直方图的范围，bucket_num 表明了一个柱子的跨度多少。简单的来讲传入 `(0, 10, 4)`，则会产生 0-2.5 2.5-5 5-7.5 7.5-10 这 4 个范围。采样的方法是 `sample(val, num)`，相当于给 val 对应的数值加 number 次。比如传入 `(6, 4)`，就会给第三个柱子加上 4 次。

## 2d Distribution

等于是 Distribution 的向量，向量中的每个元素是 Distribution。

## Histogram

和 Histogram 很像，一个柱子代表 1 单位长度，构造函数只传入 max。采样方法同上。

## SparseHistogram

同 Histogram，但是只显示不为 0 的柱子，相当于调用一次 simple 产生一个柱子，所以称之为稀疏。

## Formula 

接收一个算式表达，在最后才计算结果。

## 构造函数

继承 group，加自己的变量就行了，构造的时候传递一个对象表示这个统计变量属于哪个 simobject，可以传递 this 指针。