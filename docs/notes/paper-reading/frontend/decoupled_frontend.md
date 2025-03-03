# decoupled front-end

主要讲的是超标量处理器中的前端设计，如何提高取指令的带宽。可以看到的是从工业界的角度来看，解耦合的前端确实是被大量使用的。同时香山处理器的前端设计也是解耦合的，这篇文章主要讲的是解耦合前端的一切关键点。

## 基于基本的预取

解耦合的前端到底解耦合了什么。耦合的前端将分支预测器和 icache 耦合在了一起，这就会出现一种情况，当 icache miss 的时候，由于 cpu 拿不到指令，分支预测器就不能根据指令预测接下来的地址，并且这个问题可能还会经常出现。解耦合的前端就是引入了一层缓冲，能让分支预测独立于 icache 进行，也就是说 icache miss 的时候，分支预测也能继续向下。这个解耦合是通过引入 FTQ 实现的，FTQ 中的每个条目称为 FTB(Fetch Target Block)。这个结构是以基本块(就是日常理解的基本块)为单位工作的，也就是说，在FTB中存的是下个基本块，在当前 icache 取这个基本块的时候，下一个基本块的地址已经被预测并放到FTB中了。这样在 icache block 的时候，FTQ 中的条目还是能够被送入进行工作，分支预测并不会暂停，这就是主要的思想。

后续的相关设计还包括恢复、取指长度，同时关联到 cache 端口设计之类的，就没有深入研究了。

## 取指令指导的预取

预取的细节还没有针对源代码去看。但是可以看到的是，对于预取，都是针对 FTQ 上的条目做判断然后决定预取，从[^2]中可以看出，选取从哪个条目开始预取，从哪个条目停止，都是从实验数据得出来的，说明更多的还是从轨迹进行的量化分析，而不是通过理论分析，这种东西也或许很难从理论分析。另一个需要注意的是，不管是[^2]还是[^3]都提到了发出预取请求之后，对预取请求进行的后处理，发出的预取请求也会先存在一个队列中，而不是直接通到 cache 中，这就表明后续还是有时间对预取队列中的条目进行调整，实际也是这么做的，在后续还会根据不同的策略对预取的请求进行调整，优化对带宽的利用。

还有提到的就是在cache端口空闲的情况下，尝试对已经到达的cache请求进行检查，如果cache中的一些请求已经达到了cache，在cache中了，就将这些请求移除掉，防止重复的取。

---
[^1] Reinman, Glenn, Todd Austin, and Brad Calder. "A scalable front-end architecture for fast instruction delivery." ACM SIGARCH Computer Architecture News 27.2 (1999): 234-245.
[^2] Reinman, Glenn, Brad Calder, and Todd Austin. "Fetch directed instruction prefetching." MICRO-32. Proceedings of the 32nd Annual ACM/IEEE International Symposium on Microarchitecture. IEEE, 1999.
[^3] Ishii, Yasuo, et al. "Re-establishing fetch-directed instruction prefetching: An industry perspective." 2021 IEEE International Symposium on Performance Analysis of Systems and Software (ISPASS). IEEE, 2021.
