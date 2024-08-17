# bash 使用

## 介绍

### 内建命令

内建命令即 bash 内部的命令，或者说它们就是 bash 的一部分。内建意味着只要你输入这些命令就默认会执行这些命令，常见的内建命令如 `cd`、`echo` 等等。

## bash 特征

### 管道

`|` 管道符号往往连接多个命令，将前面命令的标准输出作为后面命令的标准是输入。`|&` 是一种特殊的管道，他将标准错误合并到标准输出并向后面传递。管道连接的各个命令都是在**一个新的 shell 环境下执行的**，毕竟是一个新的进程。管道的返回值是最后一个命令的返回值。除非 `pipefail` 这个选项被使能，这个管道使能后，整个管道的返回值是成功或者是管道中发生错误的一个返回值。

### 命令序列

> A list is a sequence of one or more pipelines separated by one of the operators ‘;’, ‘&’, ‘&&’, or ‘||’, and optionally terminated by one of ‘;’, ‘&’, or a newline.

命令序列被定义为由 ‘;’, ‘&’, ‘&&’, 或 ‘||’ 这四个符号分隔，以 ‘;’, ‘&’, 或 newline 结束的序列。

当用 ‘&’ 作为终结符号的时候，命令会成为异步的命令并在后台执行，这个命令是在子 shell 中执行的，并且这个命令立刻会有返回值1.

‘；’ 用来分隔命令，用 ‘；’ 分隔的命令是一条跟着一条执行的，前面的命令执行完了才会执行后面的。

‘&&’ 和 ‘||’ 用来连接两个命令，‘&&’ 当且仅当前面返回为 0 才会执行后面的命令，‘||’ 当且仅当前面返回不为 0 的时候执行后面的命令。用这两个符号连接的命令的返回值是最后一个命令的返回值。

### 混合命令模式

下面命令中的 ';' 都可以用换行符号替代。

#### until 结构

> until
> The syntax of the until command is: `until test-commands; do consequent-commands; done`
> Execute consequent-commands as long as test-commands has an exit status which is not zero. The return status is the exit status of the last command executed in consequent-commands, or zero if none was executed.

until 后面的命令返回非 0 的时候这个结构就一直执行，除非返回 0 为止。这一整个结构的返回值为结构体中命令的返回值，如果一次都没执行就返回 0.

> while 
> The syntax of the while command is: `while test-commands; do consequent-commands; done` 
> Execute consequent-commands as long as test-commands has an exit status of zero. The return status is the exit status of the last command executed in consequent-commands, or zero if none was executed.

和上面一样，只不过是 test command 返回 0 的时候才一直执行。

还有两种形式的 for：

`for name [ [in [words ...] ] ; ] do commands; done`

在 `[in [words ...] ]` 提供的时候，这个循环会对这之中的元素都执行命令，当不提供的时候，会对位置参数执行命令，等同于 `in $@`。

另一种形式为：

`for (( expr1 ; expr2 ; expr3 )) ; do commands ; done`

先执行 expr1，在执行 expr2,如果非 0， 执行命令，再执行 expr3.直到 expr2 为 0 为止。

break 和 continue 关键字能够用来控制循环。

#### 条件判断

if 语句的结构如下：

```bash
if test-commands; then 
    consequent-commands; 
[elif more-test-commands; 
    then more-consequents;] 
[else 
    alternate-consequents;] 
fi
```

标准的 if 结构。

case 语句的结构：

```bash
case word in [ [(] pattern [| pattern]...) command-list ;;]... esac
```

中间能够包含模式匹配，每个模式匹配之间 `|` 间隔。多个子句之间可以用 ‘;;’, ‘;&’  或 ‘;;&’ 相连，‘;;’ 一次匹配成功执行命令就停止，‘;&’一次匹配成功执行命令之后还会执行下一个匹配的命令然后停止，‘;;&’ 会吧每个都匹配一遍才停止。如果没有任何匹配返回值为0,如果有返回值为执行的命令。

select 语句的结构：

```bash
select name [in words ...]; do commands; done
```

会在标准输出中展现出一个列表，供用户选择，并从标准输入中读取用户的选择。

当读取到空行的时候会重复读取，读取到 EOF 的时候读取停止并返回1.其他情况如果产生了正确的列表选择，选择的变量保存在 name 中，选择的数字保存在 `$REPLY` 中华龟，没有选择正确的，name 会被设置成 null 值。

每次选择之后都会重复执行 select，除非遇到 break。

`(( expr ))` 会去掉**算数表达式**expr 中的双引号并执行 expr，双括号返回 0 假如 expr 非 0,返回 1 假如expr为 0。

`[[ expr ]]` 解析条件表达式，返回 0 或 1 由后续的表达式结果决定。

#### 分组表达式

`()` 和 `{}` 都对表达式分组，分组表达式的重定向对一个分组中的命令生效。`()` 中的命令在子 shell 中执行，而 `{}` 中的命令在当前上下文中执行。

### Coprocesses

类似于创建出一个子进程，其中的内容在子 shell 中异步执行。格式为 `coproc [NAME] command [redirections]`。在执行这个命令之后，shell 会和子 shell 产生一个数组变量 NAME， `NAME[0]` 指代 Coprocesses 的标准输出，`NAME[0]` 指代 Coprocesses 的标准输入。subshell 的进程 id 会被保存在 NAME_PID 这个变量中。

### 函数

函数定义可以为 `fname () compound-command [ redirections ]` 或者 `function fname [()] compound-command [ redirections ]` 中的一种。FUNCNAME这个变量的第一个元素被设置成函数名称，除了0之外的位置参数代表传入的参数。函数的返回值为 return 显式指定的值，如果没有指定就是最后一条指令的值。

### 参数

bash 的参数采取 kv 的形式，同时还能附带很多属性，如果值没有被设置，值就是空字符串。对值能进行追加操作：

1. 应用于整数属性的时候，算数想加。
2. 数组变量的追加直接加到后面。
3. 字符串相加直接加到字符串后面。

对于值还能创建引用。

#### 位置参数

位置参数在函数调用的时候使用，也能够被一些内建的命令设置。

#### 特殊参数

`$*` 展开成从1开始的位置参数。例如 "$*" 展开成 "$1c$2c..."，其中 c 这个分隔符是内建的命令指定的。

`$@` 展开位置参数，在双引号情况下展开成 `"$1" "$2"` 的形式。

`$#` 展开成位置参数的个数。

`$?` 展开成前一个管道的退出状态。

`$$` 拓展到进程 id。

`$!` 最近的一个在后台的进程 id。

`$0` 当前执行 shell 的文件名。

### 拓展

shell 中的拓展有括号拓展、波浪号拓展、参数变量拓展、算数拓展、命令替换（从左到右）、分词拓展、文件名拓展，优先级就是前面的这个排序。拓展后会进行引号移除。只有括号拓展、分词拓展、文件名拓展回增加单词的数目。

#### 括号拓展

括号拓展只进行文本替换，顺序是从左到右。括号中可以是 `{x,y,z}` 这样的形式，这种形式下生成 `x y z`，也可以是 `{x..y[..incr]}` 的形式，这种形式x和y都要是整数或者字母，这种形式下比如 `{1..5..2}` 生成 `{1 3 5}`.

#### 波浪号拓展

一般情况下会被拓展成 HOME。`~+` 拓展成当前目录，`~-` 拓展成上一个目录。`~+N` 从目录栈低开始访问，`~-N` 从目录栈顶开始访问。`~username` 指代某个用户的 HOME。

#### 命令拓展

命令拓展的两种形式为 `$(command)` 或者 `‘command‘` ，会对其中的命令做执行并替换这个变量。命令替换是可以嵌套的。

#### 表达式替换

`$(( expression ))` 对其中的表达式进行替换。

#### 进程替换

`<(list)` 和 `>(list)` 可以将命令的结果作为输出或者输出，这可以将其表示为一个文件描述符。






