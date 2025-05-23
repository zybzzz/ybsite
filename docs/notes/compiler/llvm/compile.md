# llvm compile

直接翻到最下面看 add_subdir 就行了，前面都是选项的设置。

## lib/demangle

主要用来还原 cpp 在链接后的符号名，算是一个工具。

## lib/support 

support 下封装了一堆工具类。

## lib/TableGen

tablegen parser 的实现

## util/tablegen

tablegen 后端的实现

## include 

头文件

## lib

llvm 的主要代码，里面分了很多的目录，在目录下会调用 tablegen 生成想要的信息。

在每个子目录下基本都是把 td 用各个后端生成出来用。

## MLIR

等于到低层次很难做优化，会丢失一些信息，在高层次做优化调度就行。在高层次有自己的 IR 定义，称之为方言。可以自己写 DSL 转成前端然后做优化。