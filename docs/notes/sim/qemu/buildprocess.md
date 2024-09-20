# qemu 构建过程

简单记录 qemu 的构建过程。根据官网给定的编译过程，只要使用 configure 脚本进行配置，然后进行 make 就编译了。实际上的过程没有这么简单，还是调用 meson 等构建系统进行构建。

第一步的 configure 实际上是记录一些配置的信息，用于给后面的 meson 等编译工具进行使用，configure 的配置选项可以通过 `./configure --help` 查看，当然也能直接通过查看这个 shell 文件进行查看，毕竟这个 shell 并不是自动生成的，是具有可读性的。值得一提的是可以通过在使用这个配置文件的过程中传入 `-DXXX=XXX` 的参数来给 meson 编译工具传递参数。

第二步就是直接在 build 目录下 执行 make，make 实际上调用了 meson 生成了后端的 ninja build 文件，然后再根据 ninja build 文件调用 ninja 进行 build，生成的 ninja 后端文件可读性是很差的，因此只需要重点关注 `meson.build` 文件就行了。

首先需要关注的是几个 meson 的 api：

| **方法名称**  | **作用**  |
|--- |--- |
| **subdir**  | **调用某个子目录下的 meson.build**  |
| **static_library**  | **生成静态库，不一定出来 .a，可能是很多可重定位的目标文件放在 .p 目录下。**  |
| **executable**  | **生成可执行文件**  |
| **structured_sources**  | **返回一个能够添加等待编译源文件的集合**  |

在 build 目录下的 meson.build 中值得关注的是：

```python
subdir('linux-user')
```

这就是很显然的进入到 `linux-user` 中去进行 meson 的构建，这个目录下的 meson.build 文件如下：

```python
if not have_linux_user
   subdir_done()
endif

linux_user_ss = ss.source_set()

common_user_inc += include_directories('include/host/' / host_arch)
common_user_inc += include_directories('include')

linux_user_ss.add(files(
  'elfload.c',
  'exit.c',
  'fd-trans.c',
  'linuxload.c',
  'main.c',
  'mmap.c',
  'signal.c',
  'strace.c',
  'syscall.c',
  'thunk.c',
  'uaccess.c',
  'uname.c',
))
linux_user_ss.add(rt)
linux_user_ss.add(libdw)

linux_user_ss.add(when: 'TARGET_HAS_BFLT', if_true: files('flatload.c'))
linux_user_ss.add(when: 'TARGET_I386', if_true: files('vm86.c'))
linux_user_ss.add(when: 'CONFIG_ARM_COMPATIBLE_SEMIHOSTING', if_true: files('semihost.c'))

syscall_nr_generators = {}

gen_vdso_exe = executable('gen-vdso', 'gen-vdso.c',
                          native: true, build_by_default: false)
gen_vdso = generator(gen_vdso_exe, output: '@BASENAME@.c.inc',
                     arguments: ['-o', '@OUTPUT@', '@EXTRA_ARGS@', '@INPUT@'])

subdir('aarch64')
subdir('alpha')
subdir('arm')
subdir('hppa')
subdir('i386')
subdir('loongarch64')
subdir('m68k')
subdir('microblaze')
subdir('mips64')
subdir('mips')
subdir('ppc')
subdir('riscv')
subdir('s390x')
subdir('sh4')
subdir('sparc')
subdir('x86_64')
subdir('xtensa')

specific_ss.add_all(when: 'CONFIG_LINUX_USER', if_true: linux_user_ss)

```

这是很典型的子目录构建流程，创建了源代码集合，进行子目录下的构建，然后将这个源文件的集合加入到根 meson.build 定义的源文件集合中。

然后值得关注的是根 meson.build 中的 qemu 可执行文件的生成：

```python
if target.endswith('-softmmu')
execs = [{
    'name': 'qemu-system-' + target_name,
    'win_subsystem': 'console',
    'sources': files('system/main.c'),
    'dependencies': []
}]
if host_os == 'windows' and (sdl.found() or gtk.found())
    # ...
endif
if get_option('fuzzing')
    # ...
endif
else
execs = [{
    'name': 'qemu-' + target_name,
    'win_subsystem': 'console',
    'sources': [],
    'dependencies': []
}]
endif
foreach exe: execs
exe_name = exe['name']
if host_os == 'darwin'
    exe_name += '-unsigned'
endif

emulator = executable(exe_name, exe['sources'],
            install: true,
            c_args: c_args,
            dependencies: arch_deps + exe['dependencies'],
            objects: lib.extract_all_objects(recursive: true),
            link_depends: [block_syms, qemu_syms],
            link_args: link_args,
            win_subsystem: exe['win_subsystem'])

```

这里就能看出 qemu 可执行文件的生成方式：

1. 对于 qemu.system，他们的 main 函数参考 `exe['sources']`，也就是 `files('system/main.c')`。
2. 对于 qemu.user，他们的 main 函数参考 `exe['sources']`，此时为空值，这是因为之前 meson.build 在 linux-user 子目录下已经把 main.c 编译成 .o 了，这时候只要链接就行了。

具体的链接依赖需要依靠 meson.build 具体参考。

随后 meson.build 进行一些其他模块的编译，输出一些提示的信息，就结束了。
