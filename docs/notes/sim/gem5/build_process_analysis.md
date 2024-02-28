# gem5 build process analysis

这篇文章记录 gem5 的基于 scons 的构建过程，在写这篇笔记的时候我参照的版本为 v23.1.0.0 的版本，我将在此详细解析 scons 脚本的运行过程，不略过任何部分，当然对于无关或者不影响项目的部分不做解释。

## 整体构建流程

在整篇文章中，称 gem5 的安装目录为 root 目录，即有 `root = path-to-gem5`，这两者指的是一个东西。gem5的构建开始于 `root/SConstruct`，后进入到 `root/src/Sconscript`， 在 `root/src/Sconscript` 中会递归的向下执行项目中所有的 scons 脚本，直到最后在 `root/src/Sconscript` 中构建完成。因此这篇文章开始于 `root/SConstruct` 的解析，到 `root/src/Sconscript`。并且假设构建的命令是 `scons build/X86/gem5.debug`，并且假设是在 root 目录中执行这个命令。

另外值得一提的是，scons 本质是基于 python 的，因此对于 scons 脚本的执行过程是能通过 python 打断点调试的。

## 从 `root/SConstruct` 开始

```python
# Global Python imports
import atexit
import itertools
import os
import sys
import pdb

from os import mkdir, remove, environ, listdir
from os.path import abspath, dirname, expanduser
from os.path import isdir, isfile
from os.path import join, split

import logging
logging.basicConfig()

# SCons imports
import SCons
import SCons.Node
import SCons.Node.FS
import SCons.Tool

if getattr(SCons, '__version__', None) in ('3.0.0', '3.0.1'):
    # Monkey patch a fix which appears in version 3.0.2, since we only
    # require version 3.0.0
    def __hash__(self):
        return hash(self.lstr)
    import SCons.Subst
    SCons.Subst.Literal.__hash__ = __hash__
```

导入相关的包并检查特殊版本的 scons，并对特殊版本的 scons 做特殊处理。

```python
########################################################################
#
# Command line options.
#
########################################################################

linker_options = ('bfd', 'gold', 'lld', 'mold')

AddOption('--no-colors', dest='use_colors', action='store_false',
          help="Don't add color to abbreviated scons output")
AddOption('--with-cxx-config', action='store_true',
          help="Build with support for C++-based configuration")
AddOption('--ignore-style', action='store_true',
          help='Disable style checking hooks')
AddOption('--linker', action='store', default=None, choices=linker_options,
          help=f'Select which linker to use ({", ".join(linker_options)})')
AddOption('--gold-linker', action='store_const', const='gold', dest='linker',
          help='Use the gold linker. Deprecated: Use --linker=gold')
AddOption('--no-compress-debug', action='store_true',
          help="Don't compress debug info in build files")
AddOption('--with-lto', action='store_true',
          help='Enable Link-Time Optimization')
AddOption('--verbose', action='store_true',
          help='Print full tool command lines')
AddOption('--without-python', action='store_true',
          help='Build without Python configuration support')
AddOption('--without-tcmalloc', action='store_true',
          help='Disable linking against tcmalloc')
AddOption('--with-ubsan', action='store_true',
          help='Build with Undefined Behavior Sanitizer if available')
AddOption('--with-asan', action='store_true',
          help='Build with Address Sanitizer if available')
AddOption('--with-systemc-tests', action='store_true',
          help='Build systemc tests')
AddOption('--install-hooks', action='store_true',
          help='Install revision control hooks non-interactively')
AddOption('--limit-ld-memory-usage', action='store_true',
          help='Tell ld, the linker, to reduce memory usage.')
AddOption('--gprof', action='store_true',
          help='Enable support for the gprof profiler')
AddOption('--pprof', action='store_true',
          help='Enable support for the pprof profiler')
# Default to --no-duplicate-sources, but keep --duplicate-sources to opt-out
# of this new build behaviour in case it introduces regressions. We could use
# action=argparse.BooleanOptionalAction here once Python 3.9 is required.
AddOption('--duplicate-sources', action='store_true', default=False,
          dest='duplicate_sources',
          help='Create symlinks to sources in the build directory')
AddOption('--no-duplicate-sources', action='store_false',
          dest='duplicate_sources',
          help='Do not create symlinks to sources in the build directory')

# ca2024lab option
AddOption('--compiler', action='store_const', default="clang",
          dest = 'compiler',
          help='This option indicates the compiler to be used in this project, ' 
          'the default is gcc, which can be specified as clang.')
```

指定了定制的命令行选项，注意这里的命令行选项是给 scons 使用的，开发者可以这里定制自己的命令行选项。这里 gem5 本身提供的命令行选项能够指定构建时候的链接器、是否开启链接时候的优化、是否开启性能分析工具之类的选项。

```python
# Inject the built_tools directory into the python path.
sys.path[1:1] = [ Dir('#build_tools').abspath ]
```

将 `root/build_tools` 加入到 python path 中，使这个模块下的 python 模块能够被找到。`build_tools` 下主要存放了一些工具模块，其中包括了将其他 Python 压缩成嵌入式 python 的工具，这些工具会在后续有所使用。

```python
# Imports of gem5_scons happen here since it depends on some options which are
# declared above.
from gem5_scons import error, warning, summarize_warnings, parse_build_path
from gem5_scons import TempFileSpawn, EnvDefaults, MakeAction, MakeActionTool
from gem5_scons import kconfig
import gem5_scons
from gem5_scons.builders import ConfigFile, AddLocalRPATH, SwitchingHeaders
from gem5_scons.builders import Blob
from gem5_scons.sources import TagImpliesTool
from gem5_scons.util import compareVersions, readCommand

# Disable warnings when targets can be built with multiple environments but
# with the same actions. This can happen intentionally if, for instance, a
# generated source file is used to build object files in different ways in
# different environments, but generating the source file itself is exactly the
# same. This can be re-enabled from the command line if desired.
SetOption('warn', 'no-duplicate-environment')

Export('MakeAction')

# Patch re.compile to support inline flags anywhere within a RE
# string. Required to use PLY with Python 3.11+.
gem5_scons.patch_re_compile_for_inline_flags()
```

这里从 gem5_scons 导入了很多东西， gem5_scons 位于 `root/site_scons` 下，这个目录中的 python 模块默认能够被 scons 找到，gem5_scons 中的内容大多是开发者编写的构建工具模块，在后续构建过程中都有用到。后续导出了 MakeAction 这个函数，能够供其他子脚本使用。

```python
########################################################################
#
# Set up the main build environment.
#
########################################################################

main = Environment(tools=[
        'default', 'git', TempFileSpawn, EnvDefaults, MakeActionTool,
        ConfigFile, AddLocalRPATH, SwitchingHeaders, TagImpliesTool, Blob
    ])

main['proj_compiler'] = GetOption("compiler")
# breakpoint()

if main['proj_compiler'] == 'gcc':
    main.Tool(SCons.Tool.FindTool(['gcc'], main))
elif main['proj_compiler'] == 'clang':
# main.Tool(SCons.Tool.FindTool(['gcc', 'clang'], main))
    main.Tool(SCons.Tool.FindTool(['clang'], main))
else:
    error("error in choose compiler")
    
    
# main.Tool(SCons.Tool.FindTool(['g++', 'clang++'], main))

Export('main')

# about term color
from gem5_scons.util import get_termcap
termcap = get_termcap()

# Check that we have a C/C++ compiler
if not ('CC' in main and 'CXX' in main):
    error("No C++ compiler installed (package g++ on Ubuntu and RedHat)")
```

随后进行 main 环境的创建， main 是 scons 中的环境对象。在创建之后，main开始选择编译器，在选择编译器完成之后导出了 main，这里导出的 main 只是一个仅仅包含了编译器的环境。后续的 `get_termcap` 设置了终端颜色的显示，随后脚本进行编译器的检查，查看环境中是否有编译器的安装，如果没有直接打印报错，终止构建过程。

