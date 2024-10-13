# 内核启动汇编

主要记录下内核启动的汇编过程，即从汇编到 c 函数启动的过程。首先从 arch/riscv 下的 lds 文件中可以看到，入口点还是 `_start` 函数，因此还是要找到 `_start` 函数。这个 `_start` 入口点位于 `head.S` 中。

`head.S` 的开头就是

```asm
__HEAD
SYM_CODE_START(_start)
```

`SYM_CODE_START` 是一个宏定义，反正就是定义了一个符号，在这个入口点的开始就直接无条件跳转到了 `_start_kernel` 函数，主要的初始化代码都在这个函数中进行，这个函数进行完成之后会跳到c语言的初始化代码中。注意汇编函数中会有很多对宏定义的判断，如果进行了某些宏定义就编译某些代码，这些宏定义需要自己去查看是否定义。

## 汇编启动主要过程

- 关中断

```asm
	csrw CSR_IE, zero
	csrw CSR_IP, zero
```

这是直接对中断相关的 csr 进行修改，这个时候发生的中断应该是直接不能响应。

- 设置虚拟内存的指针，暂时设置中断向量

```asm
	la a3, .Lsecondary_park
	csrw CSR_TVEC, a3
	call setup_vm
```

这里暂时设置的中断向量是一个死循环，set_up vm 在 config mmu 的情况下只是简单的设置两个指针。

- 配置 mmu

```asm
#ifdef CONFIG_MMU
	la a0, early_pg_dir
	XIP_FIXUP_OFFSET a0
	call relocate_enable_mmu
#endif /* CONFIG_MMU */
```

设置页表等等。同时对 satp 这个寄存器进行相关的写操作，标志虚拟内存的开启。

- 设置中断向量

```asm
	call .Lsetup_trap_vector
	/* Restore C environment */
	la tp, init_task
	la sp, init_thread_union + THREAD_SIZE
```

- soc 早期初始化和 进入到 c 语言的初始化

```asm
	call soc_early_init
	tail start_kernel
```

这里的 tail 简单的理解就是跳到 c 语言相关的初始化函数中。
