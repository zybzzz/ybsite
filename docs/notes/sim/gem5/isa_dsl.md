# isa dsl

参考[旧网站](https://old.gem5.org/The_M5_ISA_description_language.html)。整个部分的解析是 isa_parser 做的。

## 解码部分

对于 decoder 的定义一般定义在 `{ISA}/decoder.isa` 中。很显然的看出是调用 c 风格的 switch 来定义 decoder。这部分的语法和 c 应该是很像的。

### 格式块

使用格式块的典型两段代码为：

```cpp
decode OPCODE {
  0: Integer::add({{ Rc = Ra + Rb; }});
  1: Integer::sub({{ Rc = Ra - Rb; }});
}
```

```cpp
decode OPCODE {
  format Integer {
    0: add({{ Rc = Ra + Rb; }});
    1: sub({{ Rc = Ra - Rb; }});
  }
}
```

decoder 解释到最后无非就是把 decoder.isa 中的定义转换成 cpp 中的 staticInst，这里的 format 就决定了以后生成的这个 cpp 类长成什么样，format 的定义在 `{ISA}/format` 下，底下打开一看，很多 cpp 形式的文本，等待着做替换。与之相关的还有模板的概念，后续会提到。

官网上说 decoder 代码可以和 format 代码任意嵌套，但是我感觉应当是到叶子节点为止，只能出现一个 format，不然感觉会冲突。

`{{ Rc = Ra + Rb; }}` 像这种每括号括起来的一块，都是后面传递给 format 的参数。

### 默认块

简单讲解了默认情况的使用方法，没什么好说的，随便挑个具体的情况看看可能更好理解。

### isa 定义相关文件中的预处理指令

这里提到定义 ISA 相关的文件中，出现相关的带 `#` 的指令，isa_parser.py 不会处理这些指令，这些指令还是会被留到后续的 c/cpp 编译阶段被调用，也就是说 `#include` 也是在 c/cpp 中被展开，用 `#if` 控制的条件编译在那时候仍然有效。

## 声明部分

解码部分定义的怎么解码，声明部分解决的问题是准备一些可供替换的文本，用来生成最后的 cpp 类，也就是 staticInst 的具体实现。

### Format 格式

注意，Format 的语法使用的是 python 的语法。可以把 format 理解成 python 的函数，而 decoder 的最后就是在调用这个函数，给这个函数传参。调用这个函数的后果是生成供后续编译的 c/cpp 代码，生成代码的 4 个部分如下：

1. header_output: 最后的 cpp 类需要用到的头文件。
2. decoder_output: 最后生成的 cpp 类是 staticInst 的子类，这里输出的结果就是这个子类中出现在 execute 之前的方法，execute 中可以调用这些方法。
3. exec_output: 执行的核心代码，staticInst::execute 的实现。
4. decode_block: 暂时不明。

### template 格式

```python
def template BasicDecode {{
    return new %(class_name)s(machInst);
}};
```

上面是模板的典型格式，代表的就是即将生成的 cpp 代码段。模板中的 `%(?)s` 这样的参数都会被 format 生成的字典替换掉。

.isa 文件中定义的模板会被 `isa_parser.py` 解析，在解析过程中表现成一个 `template` 对象，这个对象的类是在 python 中定义的。最终被替换的文本生成实际上就是调用 template 类的 subst 方法，完成对模板也就是最后 cpp 类的生成。

### Output 格式

```python
output <destination> {{
    [code omitted]
}};
```

在 .isa 文件中定义的 output 块中间填写的代码为 cpp 代码，注意这些 cpp 代码会被原封不动的复制到最后生成的 cpp 文件中。destination 指定这部分代码复制到哪里，可以是  header, decoder, or exec 这三者之一，指定这段代码输出到的位置，分别为头文件、类定义、核心执行函数其中之一。

### let 块

let 块中完全就是 python 代码，所有 let 块中的上下文是共享的，在 `isa_parser.py` 中是可见的。let 块往往用于导出 template、定义一些公共函数等等使这些东西能够在 isa 解析的时候在全局范围内可见。

### bitfield

顾名思义，很简单，本质是利用了 cpp 的宏和模板。

### 操作数和操作数类型定义

看代码解析部分

### namespace

好像暂时没什么用

## 代码解析

### bitfield 提取

使用 `<:>` 来做位的提取，和之前一样。

### 操作数修饰符号

```python
def operand_types {{
    'sb' : 'int8_t',
    'ub' : 'uint8_t',
    'sw' : 'int16_t',
    'uw' : 'uint16_t',
    'sl' : 'int32_t',
    'ul' : 'uint32_t',
    'sq' : 'int64_t',
    'uq' : 'uint64_t',
    'sf' : 'float',
    'df' : 'double'
}};
```

类似于这样，有了这样的定义计算的表达 `Rc.sl = Ra.sl + Rb.sl;` 就能这样。操作数修饰符号每个体系结构有自己的定义。

### 指令操作数

```python

def operands {{
#General Purpose Integer Reg Operands
    'Rd': IntReg('ud', 'RD', 'IsInteger', 1),
    'Rs1': IntReg('ud', 'RS1', 'IsInteger', 2),
    'Rs2': IntReg('ud', 'RS2', 'IsInteger', 3),
    'Rt': IntReg('ud', 'AMOTempReg', 'IsInteger', 4),
    'Rc1': IntReg('ud', 'RC1', 'IsInteger', 2),
    'Rc2': IntReg('ud', 'RC2', 'IsInteger', 3),
    'Rp1': IntReg('ud', 'RP1 + 8', 'IsInteger', 2),
    'Rp2': IntReg('ud', 'RP2 + 8', 'IsInteger', 3),
    'ra': IntReg('ud', 'ReturnAddrReg', 'IsInteger', 1),
    'sp': IntReg('ud', 'StackPointerReg', 'IsInteger', 2),

    'a0': IntReg('ud', '10', 'IsInteger', 1),

    'Fd': FloatRegOp('df', 'FD', 'IsFloating', 1),
    'Fd_bits': FloatRegOp('ud', 'FD', 'IsFloating', 1),
    'Fs1': FloatRegOp('df', 'FS1', 'IsFloating', 2),
    'Fs1_bits': FloatRegOp('ud', 'FS1', 'IsFloating', 2),
    'Fs2': FloatRegOp('df', 'FS2', 'IsFloating', 3),
    'Fs2_bits': FloatRegOp('ud', 'FS2', 'IsFloating', 3),
    'Fs3': FloatRegOp('df', 'FS3', 'IsFloating', 4),
    'Fs3_bits': FloatRegOp('ud', 'FS3', 'IsFloating', 4),
    'Fc1': FloatRegOp('df', 'FC1', 'IsFloating', 1),
    'Fc1_bits': FloatRegOp('ud', 'FC1', 'IsFloating', 1),
    'Fc2': FloatRegOp('df', 'FC2', 'IsFloatReg', 2),
    'Fc2_bits': FloatRegOp('ud', 'FC2', 'IsFloating', 2),
    'Fp2': FloatRegOp('df', 'FP2 + 8', 'IsFloating', 2),
    'Fp2_bits': FloatRegOp('ud', 'FP2 + 8', 'IsFloating', 2),


    'Fx': IntReg('df', 'FMATempReg', 'IsFloating', 1),
    'Fx_bits': IntReg('ud', 'FMATempReg', 'IsFloating', 1),

    'Vd':  VecRegOp('vc', 'VD', 'IsVector', 1),
    'Vs1': VecRegOp('vc', 'VS1', 'IsVector', 2),
    'Vs2': VecRegOp('vc', 'VS2', 'IsVector', 3),
    'Vs3': VecRegOp('vc', 'VS3', 'IsVector', 4),
    'Vfof': VecRegOp('vc', 'VecFofTempReg', 'IsVector', 5),

    'rVl' : RMiscRegOp('ud', 'VecRenamedVLReg', None, 10),


#Memory Operand
    'Mem': MemOp('ud', None, (None, 'IsLoad', 'IsStore'), 5),

#Program Counter Operands
    'PC': PCStateOp('ud', 'pc', (None, None, 'IsControl'), 7),
    'NPC': PCStateOp('ud', 'npc', (None, None, 'IsControl'), 8),
}};

```

类似于这样的定义，需要重点关注的是 'IntReg' 指的是类型,以`'Rd': IntReg('ud', 'RD', 'IsInteger', 1),`为例，ud 指定操作数的类型，RD 指定在 decoder.isa 中用的时候的标记，IsInteger 指用了这条指令就会在 staticInst 中加上这个标记。IsInteger 这个部分可能会包含一个三元组(a, b, c)，只要使用就会被标记上 a，如果是源操作数会被标记上 b，如果是目的操作数会被标记上 a。

### CodeBlock

简单的来讲，这就是一个类，之间 format 中指定的都称为这个类的初始化参数，具体查看这个类应该到 parser 的文件中去查看。现在貌似是 GENCODE 中。

### InstObjParams

就是传给 template 对象用来进行字符串替换的字典，具体的可以到 isa_parser.py 中查看。想要给 template 使用的参数都通过这个往里传。

## 总流程

解析 decoder.isa，decoder.isa 指定特定的 format 进行处理，处理最后会在 decode block 中进行。总之按照上面的规则来肯定没错。
