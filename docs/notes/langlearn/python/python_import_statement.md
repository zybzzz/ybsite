# python import statement

这篇文章主要解析 python 的 import 和 from-import 语句使用。

## 前置

python 中 `.py` 结尾的文件被视为模块，包含 `__init__.py` 的目录被视为包。我认为也可以将包看成一个特殊的模块方便理解。

## import 语句

假设执行 `import A` 。若 A 是模块， python会执行这个模块的所有代码，并且创建名称空间 A 指向这个模块。若 A 是包， python 会执行这个包下的 `__init__.py` 文件并同上面一样创建一个名称空间。

## from-import 语句

假设执行 `from A import B` 。当 A 是模块或者包的时候，操作都和上面一样，模块或者 `__init__.py` 都会被执行，import 之后导入的 B 不再需要 A.B 进行访问，可以直接用 B 进行访问。当时模块的名称空间并不会被暴露，因此模块或者包中的其他信息不能被访问。

## as

为名称提供别名。
