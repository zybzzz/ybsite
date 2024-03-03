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

这里从 gem5_scons 导入了很多东西， gem5_scons 位于 `root/site_scons` 下，这个目录中的 python 模块默认能够被 scons 找到，gem5_scons 中的内容大多是开发者编写的构建工具模块，在后续构建过程中都有用到。后续导出了 MakeAction 这个函数，能够供其他子脚本使用，这个函数对执行动作进行封装，动作可以是命令行命令，也可以是函数等等。

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

随后进行 main 环境的创建， main 是 scons 中的环境对象，在创建 main 对象的时候会调用构造参数列表中的一系列工具对创造的环境进行设置，下简单列表介绍工具。

| **工具**           | **作用**                               |
|------------------|--------------------------------------|
| `default`          | scons内置工具，配置默认的编程环境                  |
| `git`              | scons内置工具，应该是git相关的工具                |
| `TempFileSpawn`    | gem5定义，尝试使用临时文件传递命令行参数               |
| `EnvDefaults`      | gem5定义，对默认的环境进行配置                    |
| `MakeActionTool`   | gem5定义，主要是对执行命令时候的打印信息做配置            |
| `ConfigFile`       | gem5定义，根据传入的参数生成配置文件，比如c语言中的#define  |
| `AddLocalRPATH`    | gem5定义，用于相对路径的设置，使编译出的可执行文件能够找到动态链接库 |
| `SwitchingHeaders` | gem5定义，用来生成一些头文件                     |
| `TagImpliesTool`   | gem5定义，应用编译脚本中的tag                   |
| `Blob`             | gem5定义，将文件嵌入到c语言中，怀疑和嵌入式 python 相关   |

在创建之后，main开始选择编译器，在选择编译器完成之后导出了 main，这里导出的 main 只是一个仅仅包含了编译器的环境。后续的 `get_termcap` 设置了终端颜色的显示，随后脚本进行编译器的检查，查看环境中是否有编译器的安装，如果没有直接打印报错，终止构建过程。

```python
# Find default configuration & binary.
# M5_DEFAULT_BINARY env var decide what to build
default_target = environ.get('M5_DEFAULT_BINARY', None)
if default_target:
    # set default target
    Default(default_target)

# If no target is set, even a default, print help instead.
if not BUILD_TARGETS:
    warning("No target specified, and no default.")
    SetOption('help', True)
```

如果在本机的环境变量中有设置`M5_DEFAULT_BINARY`，则将设置的这个变量作为默认的构建目标。如果环境变量没有设置，也没有在命令中给出构建的目标，那给出警告并打印警告信息。

```python
# reading config from build_opts
buildopts_dir = Dir('#build_opts')
buildopts = list([f for f in os.listdir(buildopts_dir.abspath) if
        isfile(os.path.join(buildopts_dir.abspath, f))])
buildopts.sort()
# just change the format
buildopt_list = '\n'.join(' ' * 10 + buildopt for buildopt in buildopts)

Help(f"""
Targets:
        To build gem5 using a predefined configuration, use a target with
        a directory called "build" in the path, followed by a directory named
        after a predefined configuration in "build_opts" directory, and then
        the actual target, likely a gem5 binary. For example:

        scons build/ALL/gem5.opt

        The "build" component tells SCons that the next part names an initial
        configuration, and the part after that is the actual target.
        The predefined targets currently available are:

{buildopt_list}

        The extension on the gem5 binary specifies what type of binary to
        build. Options are:

        debug: A debug binary with optimizations turned off and debug info
            turned on.
        opt: An optimized binary with debugging still turned on.
        fast: An optimized binary with debugging, asserts, and tracing
            disabled.

        gem5 can also be built as a static or dynamic library. In that case,
        the extension is determined by the operating system, so the binary type
        is part of the target file name. For example:

        scons build/ARM/libgem5_opt.so

        In MacOS, the extension should change to "dylib" like this:

        scons build/ARM/libgem5_opt.dylib

        To build unit tests, you can use a target like this:

        scons build/RISCV/unittests.debug

        The unittests.debug part of the target is actual a directory which
        holds the results for all the unit tests built with the "debug"
        settings. When that's used as the target, SCons will build all the
        files under that directory, which will run all the tests.

        To build and run an individual test, you can built it's binary
        specifically and then run it manually:

        scons build/SPARC/base/bitunion.test.opt
        build/SPARC/base/bitunion.test.opt
""", append=True)
```

这里主要是把 `buildopts` 这个目录中的文件名读出来并在帮助信息中展示，`buildopts` 这个目录下存放的是一些配置文件。

```python
########################################################################
#
# Figure out which configurations to set up based on the path(s) of
# the target(s).
#
########################################################################

kconfig_actions = (
    'defconfig',
    'guiconfig',
    'listnewconfig',
    'menuconfig',
    'oldconfig',
    'olddefconfig',
    'savedefconfig',
    'setconfig',
)

Help("""
Kconfig:
        In addition to the default configs, you can also create your own
        configs, or edit one that already exists. To use one of the kconfig
        tools with a particular directory, use a target which is the directory
        to configure, and then the name of the tool. For example, to run
        menuconfig on directory build_foo/bar, run:

        scons menuconfig build_foo/bar

        will set up a build directory in build_foo/bar if one doesn't already
        exist, and open the menuconfig editor to view/set configuration
        values.

Kconfig tools:
        defconfig:
        Set up a config using values specified in a defconfig file, or if no
        value is given, use the default. The second argument specifies the
        defconfig file. A defconfig file in the build_opts directory can be
        implicitly specified in the build path via `build/<defconfig file>/`

        scons defconfig build_foo/bar build_opts/MIPS


        guiconfig:
        Opens the guiconfig editor which will let you view and edit config
        values, and view help text. guiconfig runs as a graphical application.

        scons guiconfig build_foo/bar


        listnewconfig:
        Lists config options which are new in the Kconfig and which are not
        currently set in the existing config file.

        scons listnewconfig build_foo/bar


        menuconfig:
        Opens the menuconfig editor which will let you view and edit config
        values, and view help text. menuconfig runs in text mode.

        scons menuconfig build_foo/bar


        oldconfig:
        Update an existing config by adding settings for new options. This is
        the same as the olddefconfig tool, except it asks what values you want
        for the new settings.

        scons oldconfig build_foo/bar


        olddefconfig:
        Update an existing config by adding settings for new options. This is
        the same as the oldconfig tool, except it uses the default for any new
        setting.

        scons olddefconfig build_foo/bar


        savedefconfig:
        Save a defconfig file which would give rise to the current config.
        For instance, you could use menuconfig to set up a config how you want
        it with the options you cared about, and then use savedefconfig to save
        a minimal config file. These files would be suitable to use in the
        defconfig directory. The second argument specifies the filename for
        the new defconfig file.

        scons savedefconfig build_foo/bar new_def_config


        setconfig:
        Set values in an existing config directory as specified on the command
        line. For example, to enable gem5's built in systemc kernel:

        scons setconfig build_foo/bar USE_SYSTEMC=y
""", append=True)
```

这里主要是讲 `kconfig` 这些工具可以怎么配个使用生成配置，`buildopt` 目录下就是与之配合的一些配置脚本文件。

```python
# GetLaunchDir return the directory from which the user invoked the scons command
def makePathAbsolute(path, root=GetLaunchDir()):
    return abspath(os.path.join(root, expanduser(str(path))))
def makePathListAbsolute(path_list, root=GetLaunchDir()):
    return [makePathAbsolute(p, root) for p in path_list]
```

这里定义了两个帮助函数来生成绝对路径。`GetLaunchDir` 返回 scons 的启动路径。

```python
if BUILD_TARGETS and BUILD_TARGETS[0] in kconfig_actions:
    # The build targets are really arguments for the kconfig action.
    kconfig_args = BUILD_TARGETS[:]
    BUILD_TARGETS[:] = []

    kconfig_action = kconfig_args[0]
    if len(kconfig_args) < 2:
        error(f'Missing arguments for kconfig action {kconfig_action}')
    dir_to_configure = makePathAbsolute(kconfig_args[1])

    kconfig_args = kconfig_args[2:]

    variant_paths = {dir_to_configure}
else:
    # Each target must have 'build' in the interior of the path; the
    # directory below this will determine the build parameters.  For
    # example, for target 'foo/bar/build/X86/arch/x86/blah.do' we
    # recognize that X86 specifies the configuration because it
    # follow 'build' in the build path.

    # The funky assignment to "[:]" is needed to replace the list contents
    # in place rather than reassign the symbol to a new list, which
    # doesn't work (obviously!).
    BUILD_TARGETS[:] = makePathListAbsolute(BUILD_TARGETS)

    # Generate a list of the unique build directories that the collected
    # targets reference.
    
    # get path path-to-gem5/build/${VARIANT}
    variant_paths = set(map(parse_build_path, BUILD_TARGETS))
    kconfig_action = None
```

这里主要根据 target 的设置来生成后续用到的路径，我们没有使用 kconfig，于是只要考虑 else 之后的代码就行了。可以看到，这里将所有的 `BUILD_TARGETS` 都扩展为绝对路径。并将二级目录的名称设置为 `variant_paths`。

```python
########################################################################
#
# Set up various paths.
#
########################################################################

# base_dir is cource code dir
base_dir = Dir('#src').abspath
Export('base_dir')

# the ext directory should be on the #includes path
main.Append(CPPPATH=[Dir('ext')])

# Add shared top-level headers
main.Prepend(CPPPATH=Dir('include'))
if not GetOption('duplicate_sources'):
    main.Prepend(CPPPATH=Dir('src'))
```

这里主要做的事是将 `src` 的绝对路径放到 `base_dir` 里，并设置头文件的查找路径。

```python
########################################################################
#
# Set command line options based on the configuration of the host and
# build settings.
#
########################################################################

# Initialize the Link-Time Optimization (LTO) flags
main['LTO_CCFLAGS'] = []
main['LTO_LINKFLAGS'] = []

# According to the readme, tcmalloc works best if the compiler doesn't
# assume that we're using the builtin malloc and friends. These flags
# are compiler-specific, so we need to set them after we detect which
# compiler we're using.
main['TCMALLOC_CCFLAGS'] = []

# main['CXX'] represents the previously selected compiler
CXX_version = readCommand([main['CXX'], '--version'], exception=False)

main['GCC'] = CXX_version and CXX_version.find('g++') >= 0
main['CLANG'] = CXX_version and CXX_version.find('clang') >= 0
if main['GCC'] + main['CLANG'] > 1:
    error('Two compilers enabled at once?')

# Find the gem5 binary target architecture (usually host architecture). The
# "Target: <target>" is consistent accross gcc and clang at the time of
# writting this.
bin_target_arch = readCommand([main['CXX'], '--verbose'], exception=False)
main["BIN_TARGET_ARCH"] = (
    "x86_64"
    if bin_target_arch.find("Target: x86_64") != -1
    else "aarch64"
    if bin_target_arch.find("Target: aarch64") != -1
    else "unknown"
)
```

为链接时优化的标记创建列表，并且此时开始获取编译器的信息，根据编译器的信息设置到底编译到什么平台上。

```python
########################################################################
#
# Detect and configure external dependencies.
#
########################################################################

main['USE_PYTHON'] = not GetOption('without_python')

def config_embedded_python(env):
    # Find Python include and library directories for embedding the
    # interpreter. We rely on python-config to resolve the appropriate
    # includes and linker flags. If you want to link in an alternate version
    # of python, override the PYTHON_CONFIG variable.

    python_config = env.Detect(env['PYTHON_CONFIG'])
    if python_config is None:
        error("Can't find a suitable python-config, tried "
              f"{env['PYTHON_CONFIG']}")

    print(f"Info: Using Python config: {python_config}")

    cmd = [python_config, '--ldflags', '--includes']

    # Starting in Python 3.8 the --embed flag is required. Use it if supported.
    with gem5_scons.Configure(env) as conf:
        if conf.TryAction(f'@{python_config} --embed')[0]:
            cmd.append('--embed')

    def flag_filter(env, cmd_output, unique=True):
        # Since this function does not use the `unique` param, one should not
        # pass any value to this param.
        assert(unique==True)
        flags = cmd_output.split()
        prefixes = ('-l', '-L', '-I')
        is_useful = lambda x: any(x.startswith(prefix) for prefix in prefixes)
        useful_flags = list(filter(is_useful, flags))
        env.MergeFlags(' '.join(useful_flags))

    env.ParseConfig(cmd, flag_filter)

    env.Prepend(CPPPATH=Dir('ext/pybind11/include/'))

    with gem5_scons.Configure(env) as conf:
        # verify that this stuff works
        if not conf.CheckHeader('Python.h', '<>'):
            error("Check failed for Python.h header.\n",
                  "Two possible reasons:\n"
                  "1. Python headers are not installed (You can install the "
                  "package python-dev on Ubuntu and RedHat)\n"
                  "2. SCons is using a wrong C compiler. This can happen if "
                  "CC has the wrong value.\n"
                  f"CC = {env['CC']}")
        py_version = conf.CheckPythonLib()
        if not py_version:
            error("Can't find a working Python installation")

    # Found a working Python installation. Check if it meets minimum
    # requirements.
    ver_string = '.'.join(map(str, py_version))
    if py_version[0] < 3 or (py_version[0] == 3 and py_version[1] < 6):
        error('Embedded python library 3.6 or newer required, found '
              f'{ver_string}.')
    elif py_version[0] > 3:
        warning('Embedded python library too new. '
                f'Python 3 expected, found {ver_string}.')
```

定义了一个查找 `python-config` 的函数，这个函数进行嵌入式 python 的相关配置。

```python
#path-to-gem5/build/${VARIANT}
for variant_path in variant_paths:
    # Make a copy of the build-root environment to use for this config.
    env = main.Clone()
    env['BUILDDIR'] = variant_path

    gem5_build = os.path.join(variant_path, 'gem5.build')
    env['GEM5BUILD'] = gem5_build
    # make dir path-to-gem5/build/${VARIANT}/gem5.build
    Execute(Mkdir(gem5_build))

    config_file = Dir(gem5_build).File('config')
    kconfig_file = Dir(gem5_build).File('Kconfig')
    gem5_kconfig_file = Dir('#src').File('Kconfig')

    # SConsignFile we not to use 
    env.SConsignFile(os.path.join(gem5_build, 'sconsign'))
```

根据多个 path 开始构建，产生一些文件，这些文件都能在构建的目录下找到。

```python
# Set up default C++ compiler flags
    if env['GCC'] or env['CLANG']:
        # As gcc and clang share many flags, do the common parts here
        env.Append(CCFLAGS=['-pipe'])
        env.Append(CCFLAGS=['-fno-strict-aliasing'])
        # Enable -Wall and -Wextra and then disable the few warnings that
        # we consistently violate
        env.Append(CCFLAGS=['-Wall', '-Wundef', '-Wextra',
                            '-Wno-sign-compare', '-Wno-unused-parameter'])

        # We always compile using C++17
        env.Append(CXXFLAGS=['-std=c++17'])

        if sys.platform.startswith('freebsd'):
            env.Append(CCFLAGS=['-I/usr/local/include'])
            env.Append(CXXFLAGS=['-I/usr/local/include'])
            # On FreeBSD we need libthr.
            env.Append(LIBS=['thr'])

        with gem5_scons.Configure(env) as conf:
            conf.CheckLinkFlag('-Wl,--as-needed')

        linker = GetOption('linker')
        # choose linker
        if linker:
            with gem5_scons.Configure(env) as conf:
                if not conf.CheckLinkFlag(f'-fuse-ld={linker}'):
                    # check mold support for gcc older than 12.1.0
                    if linker == 'mold' and \
                       (env['GCC'] and \
                           compareVersions(env['CXXVERSION'],
                                           "12.1.0") < 0) and \
                       ((isdir('/usr/libexec/mold') and \
                           conf.CheckLinkFlag('-B/usr/libexec/mold')) or \
                       (isdir('/usr/local/libexec/mold') and \
                           conf.CheckLinkFlag('-B/usr/local/libexec/mold'))):
                        pass # support mold
                    else:
                        error(f'Linker "{linker}" is not supported')
                if linker == 'gold' and not GetOption('with_lto'):
                    # Tell the gold linker to use threads. The gold linker
                    # segfaults if both threads and LTO are enabled.
                    conf.CheckLinkFlag('-Wl,--threads')
                    conf.CheckLinkFlag(
                            '-Wl,--thread-count=%d' % GetOption('num_jobs'))

        with gem5_scons.Configure(env) as conf:
            ld_optimize_memory_usage = GetOption('limit_ld_memory_usage')
            if ld_optimize_memory_usage:
                if conf.CheckLinkFlag('-Wl,--no-keep-memory'):
                    env.Append(LINKFLAGS=['-Wl,--no-keep-memory'])
                else:
                    error("Unable to use --no-keep-memory with the linker")
    else:
        error('\n'.join((
              "Don't know what compiler options to use for your compiler.",
              "compiler: " + env['CXX'],
              "version: " + CXX_version.replace('\n', '<nl>') if
                    CXX_version else 'COMMAND NOT FOUND!',
              "If you're trying to use a compiler other than GCC",
              "or clang, there appears to be something wrong with your",
              "environment.",
              "",
              "If you are trying to use a compiler other than those listed",
              "above you will need to ease fix SConstruct and ",
              "src/SConscript to support that compiler.")))
```

设置 gcc 和 clang 的编译时候的公共标志。想要这两个编译器都搜索某个库可以在这里设置。

```python
    if env['GCC']:
        # add your lib here(gcc)
        if compareVersions(env['CXXVERSION'], "7") < 0:
            error('gcc version 7 or newer required.\n'
                  'Installed version:', env['CXXVERSION'])

        # Add the appropriate Link-Time Optimization (LTO) flags if
        # `--with-lto` is set.
        if GetOption('with_lto'):
            # g++ uses "make" to parallelize LTO. The program can be overriden
            # with the environment variable "MAKE", but we currently make no
            # attempt to plumb that variable through.
            parallelism = ''
            if env.Detect('make'):
                parallelism = '=%d' % GetOption('num_jobs')
            else:
                warning('"make" not found, link time optimization will be '
                        'single threaded.')

            for var in 'LTO_CCFLAGS', 'LTO_LINKFLAGS':
                # Use the same amount of jobs for LTO as scons.
                env[var] = ['-flto%s' % parallelism]

        env.Append(TCMALLOC_CCFLAGS=[
            '-fno-builtin-malloc', '-fno-builtin-calloc',
            '-fno-builtin-realloc', '-fno-builtin-free'])

        if compareVersions(env['CXXVERSION'], "9") < 0:
            # `libstdc++fs`` must be explicitly linked for `std::filesystem``
            # in GCC version 8. As of GCC version 9, this is not required.
            #
            # In GCC 7 the `libstdc++fs`` library explicit linkage is also
            # required but the `std::filesystem` is under the `experimental`
            # namespace(`std::experimental::filesystem`).
            #
            # Note: gem5 does not support GCC versions < 7.
            env.Append(LIBS=['stdc++fs'])
```

设置与 gcc 编译器相关的标记。

```
    elif env['CLANG']:
        # add your lib here(clang)
        if compareVersions(env['CXXVERSION'], "6") < 0:
            error('clang version 6 or newer required.\n'
                  'Installed version:', env['CXXVERSION'])

        # Set the Link-Time Optimization (LTO) flags if enabled.
        if GetOption('with_lto'):
            for var in 'LTO_CCFLAGS', 'LTO_LINKFLAGS':
                env[var] = ['-flto']

        # clang has a few additional warnings that we disable.
        with gem5_scons.Configure(env) as conf:
            conf.CheckCxxFlag('-Wno-c99-designator')
            conf.CheckCxxFlag('-Wno-defaulted-function-deleted')

        env.Append(TCMALLOC_CCFLAGS=['-fno-builtin'])

        if compareVersions(env['CXXVERSION'], "11") < 0:
            # `libstdc++fs`` must be explicitly linked for `std::filesystem``
            # in clang versions 6 through 10.
            #
            # In addition, for these versions, the
            # `std::filesystem` is under the `experimental`
            # namespace(`std::experimental::filesystem`).
            #
            # Note: gem5 does not support clang versions < 6.
            env.Append(LIBS=['stdc++fs'])


        # On Mac OS X/Darwin we need to also use libc++ (part of XCode) as
        # opposed to libstdc++, as the later is dated.
        if sys.platform == "darwin":
            env.Append(CXXFLAGS=['-stdlib=libc++'])
            env.Append(LIBS=['c++'])

```

设置与 clang 编译器相关的标记。

```python
    if sanitizers:
        sanitizers = ','.join(sanitizers)
        if env['GCC'] or env['CLANG']:
            libsan = (
                ['-static-libubsan', '-static-libasan']
                if env['GCC']
                else ['-static-libsan']
            )
            env.Append(CCFLAGS=['-fsanitize=%s' % sanitizers,
                                 '-fno-omit-frame-pointer'],
                       LINKFLAGS=['-fsanitize=%s' % sanitizers] + libsan)

            if main["BIN_TARGET_ARCH"] == "x86_64":
                # Sanitizers can enlarge binary size drammatically, north of
                # 2GB.  This can prevent successful linkage due to symbol
                # relocation outside from the 2GB region allocated by the small
                # x86_64 code model that is enabled by default (32-bit relative
                # offset limitation).  Switching to the medium model in x86_64
                # enables 64-bit relative offset for large objects (>64KB by
                # default) while sticking to 32-bit relative addressing for
                # code and smaller objects. Note this comes at a potential
                # performance cost so it should not be enabled in all cases.
                # This should still be a very happy medium for
                # non-perf-critical sanitized builds.
                env.Append(CCFLAGS='-mcmodel=medium')
                env.Append(LINKFLAGS='-mcmodel=medium')
            elif main["BIN_TARGET_ARCH"] == "aarch64":
                # aarch64 default code model is small but with different
                # constrains than for x86_64. With aarch64, the small code
                # model enables 4GB distance between symbols. This is
                # sufficient for the largest ALL/gem5.debug target with all
                # sanitizers enabled at the time of writting this. Note that
                # the next aarch64 code model is "large" which prevents dynamic
                # linkage so it should be avoided when possible.
                pass
            else:
                warning(
                    "Unknown code model options for your architecture. "
                    "Linkage might fail for larger binaries "
                    "(e.g., ALL/gem5.debug with sanitizers enabled)."
                )
        else:
            warning("Don't know how to enable %s sanitizer(s) for your "
                    "compiler." % sanitizers)

    if sys.platform == 'cygwin':
        # cygwin has some header file issues...
        env.Append(CCFLAGS=["-Wno-uninitialized"])


    if not GetOption('no_compress_debug'):
        with gem5_scons.Configure(env) as conf:
            if not conf.CheckCxxFlag('-gz'):
                warning("Can't enable object file debug section compression")
            if not conf.CheckLinkFlag('-gz'):
                warning("Can't enable executable debug section compression")

```

主要进行了以下的工作：

1. 启用代码分析器（Sanitizers）:
    - 如果指定了代码分析器（例如内存泄漏检测器、未定义行为检测器等），它会将这些分析器的选项添加到编译器和链接器的标志中。
    - 对于GCC和Clang编译器，它会添加 -fsanitize 标志以及一些特定的库标志（如 -static-libasan 用于地址分析器）。
    - 对于 x86_64 架构，如果启用了分析器，可能会增加二进制文件的大小，超过2GB。为了解决这个问题，它会使用 -mcmodel=medium 标志来扩展符号的可寻址范围。
    - 对于 aarch64 架构，它不需要额外的代码模型标志，因为默认的小代码模型已经足够。
2. 平台特定的设置:
    - 对于Cygwin平台，由于存在一些头文件问题，它会添加 -Wno-uninitialized 标志来禁用未初始化警告。
3. 调试节压缩:
    - 如果没有通过 no_compress_debug 选项禁用，它会检查编译器和链接器是否支持调试节压缩（通过 -gz 标志）。如果不支持，会发出警告。

```python
    if env['USE_PYTHON']:
        config_embedded_python(env)
        gem5py_env = env.Clone()
    else:
        gem5py_env = env.Clone()
        config_embedded_python(gem5py_env)

    # Bare minimum environment that only includes python
    # support embed python
    gem5py_env.Append(CCFLAGS=['${GEM5PY_CCFLAGS_EXTRA}'])
    gem5py_env.Append(LINKFLAGS=['${GEM5PY_LINKFLAGS_EXTRA}'])

    # perf tool
    if GetOption('gprof') and GetOption('pprof'):
        error('Only one type of profiling should be enabled at a time')
    if GetOption('gprof'):
        env.Append(CCFLAGS=['-g', '-pg'], LINKFLAGS=['-pg'])
    if GetOption('pprof'):
        env.Append(CCFLAGS=['-g'],
                LINKFLAGS=['-Wl,--no-as-needed', '-lprofiler',
                    '-Wl,--as-needed'])
```

配置嵌入式 python 的环境，添加性能分析工具所需的编译器标记。

```python
    env['HAVE_PKG_CONFIG'] = env.Detect('pkg-config') == 'pkg-config'
    # support use of pkg-config
    with gem5_scons.Configure(env) as conf:
        # On Solaris you need to use libsocket for socket ops
        if not conf.CheckLibWithHeader(
                [None, 'socket'], 'sys/socket.h', 'C++', 'accept(0,0,0);'):
           error("Can't find library with socket calls (e.g. accept()).")

        if not conf.CheckLibWithHeader('z', 'zlib.h', 'C++','zlibVersion();'):
            error('Did not find needed zlib compression library '
                  'and/or zlib.h header file.\n'
                  'Please install zlib and try again.')

    if not GetOption('without_tcmalloc'):
        with gem5_scons.Configure(env) as conf:
            if conf.CheckLib('tcmalloc_minimal'):
                conf.env.Append(CCFLAGS=conf.env['TCMALLOC_CCFLAGS'])
            elif conf.CheckLib('tcmalloc'):
                conf.env.Append(CCFLAGS=conf.env['TCMALLOC_CCFLAGS'])
            else:
                warning("You can get a 12% performance improvement by "
                        "installing tcmalloc (libgoogle-perftools-dev package "
                        "on Ubuntu or RedHat).")

    if not GetOption('silent'):
        print("Building in", variant_path)
```

根据传入的参数和配置信息，进行库的检查。

```python
    # variant_dir is the tail component of build path, and is used to
    # determine the build parameters (e.g., 'X86')
    
    # split to  build_root:path-to-gem5/build/  variant_dir:${VARIANT}
    (build_root, variant_dir) = os.path.split(variant_path)
```

将路径得到分割，最后得到的路径结果是 `build_root:path-to-gem5/build/  variant_dir:${VARIANT}`。

```python
    # Register a callback to call after all SConsopts files have been read.
    # use can set callback function(after execute )
    after_sconsopts_callbacks = []
    def AfterSConsopts(cb):
        after_sconsopts_callbacks.append(cb)
    Export('AfterSConsopts')
```

注册 sconsopts 执行完成之后的回调函数。

```python
    # config in path-to-gem5/build/extras
    extras_file = os.path.join(gem5_build, 'extras')
    # get config in path-to-gem5/build/extras, then override by command line argument
    extras_var = Variables(extras_file, args=ARGUMENTS)

    # user can add extra directories here
    extras_var.Add(('EXTRAS', 'Add extra directories to the compilation', ''))

    # Apply current settings for EXTRAS to env.
    # command line args also apply to env too
    extras_var.Update(env)

    # Parse EXTRAS variable to build list of all directories where we're
    # look for sources etc.  This list is exported as extras_dir_list.
    if env['EXTRAS']:
        extras_dir_list = makePathListAbsolute(env['EXTRAS'].split(':'))
    else:
        extras_dir_list = []

    Export('extras_dir_list')
```

设置额外的外部文件的查找路径。

```python
    # Generate a Kconfig that will source the main gem5 one, and any in any
    # EXTRAS directories.
    # not use kconfig
    kconfig_base_py = Dir('#build_tools').File('kconfig_base.py')
    kconfig_base_cmd_parts = [f'"{kconfig_base_py}" "{kconfig_file.abspath}"',
            f'"{gem5_kconfig_file.abspath}"']
    for ed in extras_dir_list:
        kconfig_base_cmd_parts.append(f'"{ed}"')
    kconfig_base_cmd = ' '.join(kconfig_base_cmd_parts)
    if env.Execute(kconfig_base_cmd) != 0:
        error("Failed to build base Kconfig file")
```

生成 Kconfig。

```python
    # Variables which were determined with Configure.
    env['CONF'] = {}

    # Walk the tree and execute all SConsopts scripts that wil add to the
    # above variables
    if GetOption('verbose'):
        print("Reading SConsopts")

    def trySConsopts(dir):
        sconsopts_path = os.path.join(dir, 'SConsopts')
        if not isfile(sconsopts_path):
            return
        if GetOption('verbose'):
            print("Reading", sconsopts_path)
        SConscript(sconsopts_path, exports={'main': env})

    # execute SConsopts file in path-to-gem5
    trySConsopts(Dir('#').abspath)
    # execute SConsopts file in path-to-gem5/extras_dir_list
    for bdir in [ base_dir ] + extras_dir_list:
        if not isdir(bdir):
            error("Directory '%s' does not exist." % bdir)
        for root, dirs, files in os.walk(bdir):
            trySConsopts(root)

    # Call any callbacks which the SConsopts files registered.
    for cb in after_sconsopts_callbacks:
        cb()
```

对于 SConsopts 文件，有如下解释：

> `SConsopts` 文件是一个特殊的文件，用于存储 SCons 构建系统的全局配置选项。当你在命令行上运行 SCons 时，SCons 会自动查找当前目录及其父目录中名为 `SConsopts` 的文件，并从中读取配置选项。这些选项会影响 SCons 的行为，例如设置默认的构建目标、指定构建缓存的位置、调整并行构建的线程数等。

读取 SConsopts 文件，进行一些 scons 全局参数的设置。

```python
    # Handle any requested kconfig action, then exit.
    # not use kconfig
    if kconfig_action:
        if kconfig_action == 'defconfig':
            if len(kconfig_args) != 1:
                error('Usage: scons defconfig <build dir> <defconfig file>')
            defconfig_path = makePathAbsolute(kconfig_args[0])
            kconfig.defconfig(env, kconfig_file.abspath,
                    defconfig_path, config_file.abspath)
        elif kconfig_action == 'guiconfig':
            kconfig.guiconfig(env, kconfig_file.abspath, config_file.abspath,
                    variant_path)
        elif kconfig_action == 'listnewconfig':
            kconfig.listnewconfig(env, kconfig_file.abspath,
                    config_file.abspath)
        elif kconfig_action == 'menuconfig':
            kconfig.menuconfig(env, kconfig_file.abspath, config_file.abspath,
                    variant_path)
        elif kconfig_action == 'oldconfig':
            kconfig.oldconfig(env, kconfig_file.abspath, config_file.abspath)
        elif kconfig_action == 'olddefconfig':
            kconfig.olddefconfig(env, kconfig_file.abspath,
                    config_file.abspath)
        elif kconfig_action == 'savedefconfig':
            if len(kconfig_args) != 1:
                error('Usage: scons defconfig <build dir> <defconfig file>')
            defconfig_path = makePathAbsolute(kconfig_args[0])
            kconfig.savedefconfig(env, kconfig_file.abspath,
                    config_file.abspath, defconfig_path)
        elif kconfig_action == 'setconfig':
            kconfig.setconfig(env, kconfig_file.abspath, config_file.abspath,
                    ARGUMENTS)
        Exit(0)

    # If no config exists yet, see if we know how to make one?
    # just kconfig read variable in build_opts
    if not isfile(config_file.abspath):
        buildopts_file = Dir('#build_opts').File(variant_dir)
        if not isfile(buildopts_file.abspath):
            error('No config found, and no implicit config recognized')
        kconfig.defconfig(env, kconfig_file.abspath, buildopts_file.abspath,
                config_file.abspath)

    kconfig.update_env(env, kconfig_file.abspath, config_file.abspath)
```

进行 kconfig 操作。

```python
    # Do this after we save setting back, or else we'll tack on an
    # extra 'qdo' every time we run scons.
    if env['CONF']['BATCH']:
        env['CC']     = env['CONF']['BATCH_CMD'] + ' ' + env['CC']
        env['CXX']    = env['CONF']['BATCH_CMD'] + ' ' + env['CXX']
        env['AS']     = env['CONF']['BATCH_CMD'] + ' ' + env['AS']
        env['AR']     = env['CONF']['BATCH_CMD'] + ' ' + env['AR']
        env['RANLIB'] = env['CONF']['BATCH_CMD'] + ' ' + env['RANLIB']

    # Cache build files in the supplied directory.
    if env['CONF']['M5_BUILD_CACHE']:
        print('Using build cache located at', env['CONF']['M5_BUILD_CACHE'])
        CacheDir(env['CONF']['M5_BUILD_CACHE'])


    env.Append(CCFLAGS='$CCFLAGS_EXTRA')
    env.Append(LINKFLAGS='$LINKFLAGS_EXTRA')
```

重新设置代码环境中的一些参数。

```python
    # env is comprehensive environment
    # gem5py_env is environment support c/cpp/python
    exports=['env', 'gem5py_env']

    # first to build ext(external)
    ext_dir = Dir('#ext').abspath
    variant_ext = os.path.join(variant_path, 'ext')
    for root, dirs, files in os.walk(ext_dir):
        if 'SConscript' in files:
            build_dir = os.path.relpath(root, ext_dir)
            SConscript(os.path.join(root, 'SConscript'),
                       variant_dir=os.path.join(variant_ext, build_dir), 
                       exports=exports, #exports variable can use in ext scons
                       duplicate=GetOption('duplicate_sources'))

    # The src/SConscript file sets up the build rules in 'env' according
    # to the configured variables.  It returns a list of environments,
    # one for each variant build (debug, opt, etc.)
    
    # go to src/SConscript
    SConscript('src/SConscript', variant_dir=variant_path, exports=exports,
               duplicate=GetOption('duplicate_sources'))
```

导出环境，并开始向各个子目录下执行 scons 脚本，先是 `ext` 目录， 再是 `src` 目录。


```python
# print warning after exit
atexit.register(summarize_warnings)
```

在整个过程执行完成之后打印警告信息并退出。
