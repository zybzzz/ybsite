# triton 项目结构

cpp 和 python 的混合项目，pybind 实现两者之间的绑定。整个项目之间的编译是由 `setup.py` 驱动的，在 `pip install -e` 的时候，默认运行 `setup.py` 里面的 `develop` 命令，这个命令的默认行为会 `build_ext` 驱动 cpp 部分的编译。也可以 `python setup.py build_ext` 自己驱动编译。

## 项目结构

python 绑定的实现在 `python/triton` 目录下。`backends` 目录主要编写了一些检测后端的模块。`compiler` 主要是 triton 前端的编译器，解析 triton 并生成 triton 的 IR。`language` 定义了 triton 的 DSL。`python/src` 中实现 pybind 和 mlir 的绑定。

