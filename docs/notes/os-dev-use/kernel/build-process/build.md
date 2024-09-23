# 内核构建过程

内核构建过程开始于顶层的 makefile，随后开始递归往下构建，makefile 太复杂，用到的时候再去看。

## 读 make 的基础

对于 4 种赋值方式的理解：

1. `:=`：立刻赋值，赋值之后不再解析
2. `=`：惰性赋值，每次用到的时候都会重新解析
3. `?=`：如果当前的值为空则赋值，不为空则不变
4. `+=`：在一个赋值后面追加

对于 makefile 中函数的理解：

1. `$(xxx )`:这种形式是调用了 makefile 中的函数。
2. `$(shell XXX)`: 这种方式是调用了 shell 脚本。

对于 makefile 中特殊标记的理解：

1. `PONEY`:不会产生实际的结果
2. `FORCE`:每次构建目标的时候不管怎么样都会执行

对于 makefile 中变量导出的理解：父文件中的变量不会导出到子变量中，需要使用显示 export 才能进行导出。另外文件中没定义的变量是 make 工具的内置变量，具体查看变量的手册进行使用和理解。

对于 makefile 中 include 的理解：直接的文本包含。

对于 makefile 的执行过程的理解，个人理解为两遍的过程。第一遍扫描变量、扫描目标、进行 include、进行 if 判断等等，第二遍根据命令行给定的目标进行构建。简单的来讲就是第一遍扫描记录信息，第二次正式进入构建的流程。

## 编译的顺序

不好说，最好的方法是 `make -nB | vim -` 导出来看。

## 编译过程关键部分

首先通过 make 相关的 config，会产生 `auto.conf`、`auto.conf.cmd` 这种自动生成的文件来给 makefile 使用控制编译过程。随后 make 一下，make 会跑根目录下的 makefile，这个根目录下的 makefile 主要是定义了全局的一些变量等等，然后往下传，同时自己还会去编译设备树之类的东西，还没具体看到。最为关键的是其 include 了 script 下的 `makefile.build`，几乎所有模块都由这个模块驱动编译。

`makefile.build` 会找到每个 obj-y 目录下的 kbuild 文件，对其中的 obj-y 子目录进行编译。这个过程是递归的，进入到子目录下也是这样的过程。在根目录下的 kbuild 中，有：

```makefile
obj-y   += init/
obj-y   += usr/
obj-y   += arch/$(SRCARCH)/
obj-y   += $(ARCH_CORE)
obj-y   += kernel/
obj-y   += certs/
obj-y   += mm/
obj-y   += fs/
obj-y   += ipc/
obj-y   += security/
obj-y   += crypto/
obj-$(CONFIG_BLOCK) += block/
obj-$(CONFIG_IO_URING) += io_uring/
obj-$(CONFIG_RUST) += rust/
obj-y   += $(ARCH_LIB)
obj-y   += drivers/
obj-y   += sound/
obj-$(CONFIG_SAMPLES) += samples/
obj-$(CONFIG_NET) += net/
obj-y   += virt/
obj-y   += $(ARCH_DRIVERS)
```

这就表示了以下这些目录是要被编译的。其中能够看到 `obj-$(CONFIG_BLOCK)` 这种引用变量配置的，这些就是在 kconfig 中设置的，设置为y就会参与到编译中。具体编译时候调用的是 `makefile.build` 中的：

```makefile
PHONY += $(subdir-ym)
$(subdir-ym):
 $(Q)$(MAKE) $(build)=$@ \
 need-builtin=$(if $(filter $@/built-in.a, $(subdir-builtin)),1) \
 need-modorder=$(if $(filter $@/modules.order, $(subdir-modorder)),1) \
 $(filter $@/%, $(single-subdir-goals))
```

实际上会展开为类似于：

```makefile
make -f ./scripts/Makefile.build obj=init \
need-builtin=1 \
need-modorder=1 \
```
