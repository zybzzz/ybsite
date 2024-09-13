# xiangshan 全系统 workload 生成

在生成 simpoint 的时候，首先需要将一个完整的 workload 交给 nemu 中去进行全系统执行，采集出 checkpoint。这里讲这个完整的 workload 是怎么生成的。主要还是跟踪 risc-v pk 中的 makefile 的执行来追踪的。

首先会进行 linux-kernal 的编译，在编译的时候会将我们自己的 initramfs 进行解析，将相关的文件打包进 vmlinux 中。这时候内核的镜像就打包好了，是真正的 linux 内核。最后想要内核启动，就需要引导程序引导内核启动。

这个引导程序就是 riscv-pk 项目中的 bbl。在进行 risck-pk 这个项目编译的时候会先通过 ./configure 进行配置，然后生成相关的配置结果。在提供 linux 内核的情况下，产生的配置配置相关的参数是：

```bash
/path/to/riscv-pk/configure --host=riscv64-unknown-elf --with-payload=/home/zybzzz/proj/openxiangshan/tools/riscv-linux/vmlinux --with-arch=rv64imac_zicsr_zifencei --enable-logo 
```

将内核的路径进行了传入，根据 autoconf 相关的配置文件，实际上为 makefile 生成了 bbl payload 的路径。随后在 make 的过程中，这个内核文件被复制，在 build 目录下生成名为 bbl_payload 的文件，这个文件实际上就是内核的拷贝。

最关键的就是后续的 bbl 的生成了，bbl 生成的命令为：

```bash
riscv64-unknown-elf-gcc -MMD -MP -Wall -Werror -D__NO_INLINE__ -mcmodel=medany -O2 -std=gnu99 -Wno-unused -Wno-attributes -fno-delete-null-pointer-checks -fno-PIE  -march=rv64imac_zicsr_zifencei -mabi=lp64 -DBBL_LOGO_FILE=\"bbl_logo_file\" -DMEM_START=0x80000000 -fno-stack-protector -U_FORTIFY_SOURCE -DBBL_PAYLOAD=\"bbl_payload\" -I. -I/home/zybzzz/proj/openxiangshan/tools/riscv-pk/pk -I/home/zybzzz/proj/openxiangshan/tools/riscv-pk/bbl -I/home/zybzzz/proj/openxiangshan/tools/riscv-pk/softfloat -I/home/zybzzz/proj/openxiangshan/tools/riscv-pk/dummy_payload -I/home/zybzzz/proj/openxiangshan/tools/riscv-pk/machine -I/home/zybzzz/proj/openxiangshan/tools/riscv-pk/util -c /home/zybzzz/proj/openxiangshan/tools/riscv-pk/bbl/bbl.c
riscv64-unknown-elf-gcc -Wl,--build-id=none -nostartfiles -nostdlib -static  -march=rv64imac_zicsr_zifencei -mabi=lp64 -fno-stack-protector -o bbl bbl.o -L.  -lbbl  -lmachine  -lsoftfloat  -lutil -lgcc -Wl,--defsym=MEM_START=0x80000000,-T,/home/zybzzz/proj/openxiangshan/tools/riscv-pk/bbl/bbl.lds
```

实际上就是编译链接，这里比较重要的两点是：

1. 指定了程序的开始地址为 0x80000000.
2. 定一个一个 BBL_PAYLOAD 的宏，这个宏指向的实际就是 linux 内核。
3. 采用 bbl.lds 链接得到 bbl。

查看这个链接文件：

```linker-script
/* See LICENSE for license details. */

OUTPUT_ARCH( "riscv" )

ENTRY( reset_vector )

SECTIONS
{

  /*--------------------------------------------------------------------*/
  /* Code and read-only segment                                         */
  /*--------------------------------------------------------------------*/

  /* Begining of code and text segment */
  . = MEM_START + 0xa0000;
  _ftext = .;

  .text :
  {
    *(.text.init)
  }

  /* text: Program code section */
  .text : 
  {
    *(.text)
    *(.text.*)
    *(.gnu.linkonce.t.*)
  }

  /* rodata: Read-only data */
  .rodata : 
  {
    *(.rdata)
    *(.rodata)
    *(.rodata.*)
    *(.gnu.linkonce.r.*)
  }

  /* End of code and read-only segment */
  . = ALIGN(0x1000);
  _etext = .;

  /*--------------------------------------------------------------------*/
  /* HTIF, isolated onto separate page                                  */
  /*--------------------------------------------------------------------*/
  .htif :
  {
    PROVIDE( __htif_base = . );
    *(.htif)
  }
  . = ALIGN(0x1000);

  /*--------------------------------------------------------------------*/
  /* Initialized data segment                                           */
  /*--------------------------------------------------------------------*/

  /* Start of initialized data segment */
  . = ALIGN(16);
   _fdata = .;

  /* data: Writable data */
  .data : 
  {
    *(.data)
    *(.data.*)
    *(.srodata*)
    *(.gnu.linkonce.d.*)
    *(.comment)
    *(.dtb)
  }

  /* End of initialized data segment */
  . = ALIGN(16);
  _edata = .;

  /*--------------------------------------------------------------------*/
  /* Uninitialized data segment                                         */
  /*--------------------------------------------------------------------*/

  /* Start of uninitialized data segment */
  . = .;
  _fbss = .;

  /* sbss: Uninitialized writeable small data section */
  . = .;

  /* bss: Uninitialized writeable data section */
  . = .;
  _bss_start = .;
  .bss : 
  {
    *(.bss)
    *(.bss.*)
    *(.sbss*)
    *(.gnu.linkonce.b.*)
    *(COMMON)
  }

  . = ALIGN(0x1000);
  _end = .;

  .payload :
  {
    *(.payload)
  }
}

```

这里值得关注的是：

1. 程序的开始地址为：0x800a0000，实际就是 NEMU 规定的开始地址。
2. 程序中有一个段位 payload 段，可以猜测这个段是内核。但是到底是哪里产生了这个段仍然是未知的。

通过 grep 的查找发现，这个段定义在了 payload.s 中：

```asm
// See LICENSE for license details.

#include "config.h"
#include "encoding.h"

  .section ".payload","a",@progbits

#if RELAXED_ALIGNMENT
  /* align payload minimally */
  .align 3
#else
  /* align payload to megapage */
  .align RISCV_PGSHIFT + RISCV_PGLEVEL_BITS
#endif

  .globl _payload_start, _payload_end
_payload_start:
  .incbin BBL_PAYLOAD
_payload_end:

```

可以看到这里产生了 `payload` section，并且可以看到有伪指令 `.incbin BBL_PAYLOAD`，这个实际上就是将 BBL_PAYLOAD 也就是 linux 内核搬到了 payload 中，显而易见，这部分后来被搬到了 bbl 中。随后这个 bbl 通过复制复制成了 bbl.bin。

总结一下，形成的 bbl 实际上是引导代码加上操作系统内核，供 NEMU 进行采样，NEMU 采样时候是在全系统的环境下更是在 linux 内核的环境下进行的。但是采样之后生成的检查点应该是托管在 pk 上的，毕竟检查点中包含的是从开始到结束的一段代码，他不是一个完整的 elf 格式文件，并不能被 linux 加载，因此他应该是托管在 pk 上的，这是我的猜测。
