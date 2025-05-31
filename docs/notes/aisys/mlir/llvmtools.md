# 工具类的封装

llvm 工具类的封装都实现在 `ADT` 和 `Support` 下。

## ADT

1. AddressRanges：地址范围的封装，地址范围容器的封装。
2. ADL: Argument Depend look up 用的。
3. AllocatorList：一个可以自己指定分配器的链表。
4. any: 类似于 void*， 可以将编译时期不知道类型的东西容纳到里面。一定要是可复制的类型才能在里面，同时在转换之前会进行类型判断。
5. APFixedPoint, APFloat, APInt, APSInt：数据类型的低层次封装。
6. ArrayRef: 指向一段内存的视图。分为正常类型和 mutable 类型，正常类型保存可读视图，mutable 类型保存读写视图。他们都不保存数据，只保存指向底层数据的指针，如果想要，也提供了方法拷贝。
7. bit*: 封装任何能想象到的 bit 操作，同时实现可能还考虑到了大小端序。
8. BreadthFirstIterator：广度优先迭代器的封装。
9. CachedHashString: 分 string 和 stringref 的实现，主要是这两个实现再带一个 hash 值，可能在存到 map 里面的时候会有用。
10. CoalescingBitVector：也是一个 bitvector，他更加适合用于数据分散的场景。
11. ConbinationGenerator：一个序列生成器，用户可以注册回调函数使用生成的序列。
12. ConcurrentHashTable：并发哈希表，提供接口来插入元素，如果已经有了就返回在table中的指针。
13. DeltaAlgorithm：一个集合缩小化的方法，给定一个输入集合，程序会尝试缩小集合中的元素，将集合缩小到一个能够保持原来特征的尺寸。在 debug 的时候缩小错误集合挺好的。
14. DeltaTree： BTree 的一种实现。
15. Dense*：提供了密集 Map 和密集 Set 的实现。
16. DepthFirstIterator：深度优先遍历迭代器的实现。
17. DirectGraph: 直接的图实现，顺便封装了节点和边，插入图并不创建边，边要手动相连。
18. edit_distance：计算 Levenshtein distance，指把一个字符串转换成另外的字符串需要的步数。
19. EnumeratedArray：能用某种 Enum 类型访问的数组。自己实际存储了元素，并不是视图。
20. EpochTracker：用于迭代时候计数用的，通过一个计数能够更快的在错误的情况的时候 assert 掉。
21. EquivalenceClasses：并查集的封装实现。
22. fallible_iterator：能够放回错误情况的迭代器 wrapper，也是能够用于快速退出。
23. Floatingpointmode：一些浮点模式，比如说溢出等等。
24. FunctionExtras：对 std::function 的一些增强。
25. GenericConvergenceVerifier: 貌似是对某些手链操作的认证。
26. Generic*：一些通用的实现，包括分析、SSA、机器周期等等。
27. GraphTrait：创建图的视图，能够对图进行一些不同方式的遍历。
28. Hashing：创建 hash 值的一些接口。
29. identity：一个默认函数的实现，类似于cpp20的 identity，什么都不做，类似于占位符。
30. ilist：列表的实现，不同于普通的链表，实现采用的是双向循环的链表，注意，实现中告知了最好不要使用 size 方法。
31. ImmutableMap，ImmutableSet，ImmutableList：状态不变的数据结构，等于插入和修改不会改变内部的状态，而是会保存快照，之后方便回滚之类的。
32. IndexedMap：其实就是简单的 vector，就是传入 index 的能有一个函数能hash一下，改变下访问的下标。
33. IntEqClasses：为小数字优化的并查集？
34. IntervalMap 和 IntervalTree：区间查询。
35. IntrusiveRefCntPtr：类似于智能指针，维护计数的。
36. iterator：迭代器抽象。
37. iterator_range：一组迭代范围的创建。
38. LazyAtomicPointer：Lock free 的原子写保证。
39. MapVector：一个 Map，里面装了 vector。
40. PackedVector：压缩存储数据的 vector，在数据被存入之后，可能只会保存其中的几位。
41. PagedVector：每次按页开辟空间的 vector。
42. Pointer*.h: 一个指针类型同时携带着其他类型。
43. PostOrderIterator.h：结合 graphtrait 使用，估计也是用来迭代的。
44. Prioriry*：优先队列的实现。
45. RewriteBuffer：在很多时候，编译器在做了一些优化之后不能直接改变原先的文件，而是需要先写在buffer中，最后准备好了再写到文件中。
46. RewritePope：貌似也是一种字符串的实现。
47. SCCIterator：查找全联通分量的迭代器。
48. ScopeHashTable: 只在自己代码作用域内才会产生影响的 hashTable。
49. ScopeExit：用于封装退出某些作用域的时候的操作。
50. Sequence：序列产生器，能够产生 (a,b) 这种区间序列的操作。
51. SetOperations：对数据结构进行 set 赋值操作的一些运算符。
52. SetVector：具有 Set 语义的 Vector。
53. simple_list：侵入式链表的实现，链表只管理指针，内存分配要由用户显式管理。
54. Small*：在数目比较少的时候采用的数据结构。
55. Sparse*：一些用于稀疏情况的数据结构。
56. StableHash：用于计算模块和不同版本编译器之间的 Hash。
57. Statistic：记录 pass 运行时候的一些统计数值。
58. STL*：一些对 STL 功能的增强等等。
59. StringRef：自己不维护数据，指向别的 string，string的视图，指向的 string 可以不以 `\0` 结尾。
60. StringSwitch：用 string 进行 switch 的节奏。
61. String*：其他为 String 封装的数据结构。
62. TinyPtrVector：为了只有 0 或一个元素的 Vector 设计
63. trie*：trie相关。
64. Twine：貌似是某些情况下用来拼某些字符串用的。
65. TypeSwitch：对于 Type 进行 switch，实际上是动态的类型分发。
66. UniqueVector：在插入的时候同时为每个元素分配id。

## support

1. AdvsioryLock：一种同步原语的实现
2. Alignment：检查对齐。
3. Alignof：封装了对齐内存的类。
4. AllocatorBase：所有 llvm 风格分配器的基本接口。
5. Allocator: bumppointerallocator 的定义，这种分配器不一个个释放空间，而是一次性释放。
6. ArrayRecycle：貌似是小数组的回收器。
7. atomic：原子操作的实现。
8. AtomicOrdering：对 c 内存模型的支持。
9. Automaton: 对 table gen 自动机构造的支持。
10. BalancedPartitioning：平衡的分割一个图
11. Base64/BCD：与 Base64 和 BCD 编码解码有关。
12. BinaryStream*：对 stream format 读写的封装，类似于视图。
13. BlockFrequency：统计基本快的频繁度。
14. BranchProbability：统计分支的倾向，能够在 IR 间传递访问。
15. capacity：计算 AST 使用的内存大小。
16. casting：类似于做强制转换修改的操作。
17. CFG*：控制流图相关。
18. CheckArthi：检查是不是算数相关的操作溢出了
19. cacular_raw_ostream：循环缓冲区实现的 raw ostream
20. CodeGen：代码生成相关
21. CommandLine：几乎所有能想到的命令行操作的封装。opt 的实现方式貌似是先注册 opt，然后根据命令行的传入修改 opt，还能加一些会调。
22. Compiler：封装与编译器相关的宏
23. Compression：压缩成特定的格式。
24. CrashRecoveryContext：一个检测发生 crash 的包装器，在调用函数的时候可以用这个包装下，在 if 判断中判断是不是有 crash 发生。
25. DataExtractor：从某个位置开始解析字符串，应该用于报错的时候。
26. Debug.h：用来使能 debugflag 用的。
27. DebugCounter：类似也是个计数器，到数字了assert掉。用在编译的时候。
28. DivisionByConstant：用那个神奇的算法来提升除法的效率。
29. DynamicLibrary：动态库加载的接口封装。
30. ELF*：ELF 相关。
31. Err*：错误处理相关以及错误类的封装，经常使用。
32. ExponentialBackoff：保证某件事已经在某个时间内完成？
33. File*：封装和文件系统相关的。
34. format*：格式化打印相关的。
35. Generic*：为分析 pass 提供的一些封装。
36. GraphWrite：为画图提供的一些封装。
37. initllvm：初始化
38. instructioncost：计算指令的开销。
39. Knowbits：貌似是对 bit 串的 0 1 检测。
40. lineiterator：行迭代器，一行行的读。
41. LockFileManager：在多线程的情况下管理被线程独占的文件
42. LogicalResult：对返回结果是 true 和 false 一种类似于可读性和功能性的封装。
43. MathExtra：提供了一些数学函数。
44. memalloc：貌似是对外提供的内存分配接口。
45. Memory：分配出的内存。
46. memorybuffer：以 memorybuffer 的形式返回各种内存中的空间。
47. mutex：锁实现。
48. nativeformating：格式化的另一些接口。
49. optimizedstructlayout：对 struct 布局的一些优化。
50. optimizestrcmp：对 stringref 比较的优化
51. Parallel：多线程处理的逻辑。
52. Path:路径格式工具类
53. pluginloader：插件加载器
54. prettystacktrace：调用栈打印
55. Printable：显式表示可打印的包装类。
56. Process：对当前进程信息的获取。
57. program：很杂，能进行输出重定向等等。
58. row_os_stream：对输出流封装了颜色。还有其他的一些封装。
59. Regex：模式匹配的实现。
60. SaveAndRestore：像暂时存放东西的容器。
61. ScaledNumber：对数字的一些操作。
62. scopedprinter：带范围的打印。
63. SMLoc：源代码文件的范围行数等等。
64. SourceMgr：和源代码诊断相关的。
65. StringSaver：存字符串并返回 StringRef。
66. Swapbytecode：交换操作。
67. TargetSelect：编译目标平台的选择。
68. Thread*：封装线程。
69. Time*:时间检测相关的。
70. type_trait：自己的一些 trait 封装。
71. Typename：返回类型名
72. typesize：类型大小相关。

## mlir/support

1. ADTExtras：对 ArrayRef 的增强， COW.
2. DeugStringHelper: debug string 的帮助函数
3. fileutil：新封装的打开文件的操作。
4. Interface： mlir interface
5. LLVM.h: 封装用到 LLVM 的一些东西。
6. LogicalResult：对 LLVM LogicalResult 的一些封装。
7. StorageUniquer：反正也是涉及到类型的注册。
8. ToolUtil：分割文件的帮助方法。
9. ThreadLocalCache: ThreadLocal 相关





