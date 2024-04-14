# _m5 在 gem5 中来自哪里

在 gem5 的 python 脚本中可能会出现 `import _m5` 这种操作，但是找遍全部的文件无法找到这个具体定于 `_m5` 模块的 python 文件。实际上 gem5 中用 `_m5` 定义了一些不存在具体 python 文件的 python 模块，是的，这些模块中的类都是从 cpp 的 pybind 定义的，因此存在于运行时，但是找不到具体的 python 文件。

符合这种规则的 `_m5` 模块分布在 `src/python/pybind11` 下，在这个模块下的文件都定义了很多位于 `_m5` 中的模块，并将模块的方法和 cpp 的方法进行绑定。这些定义都会在 gem5 启动的时候被执行，gem5 是通过 `GEM5_PYBIND_MODULE_INIT` 这个宏来实现的。
