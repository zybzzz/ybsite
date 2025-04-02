# diff

diff 使用用来比较两个文件的，两个文件比较导出的结果能够成为 patch 被应用到别的文件中。

主要是记录一些使用过程中的问题，当不确定能否应用的时候，diff 提供 check 功能先 check 一下，也可以部分应用，然后检查哪些没应用好然后在做相关的修改。具体可以 man diff 看下。

比较重要的一点是能被 diff 的格式被称为统一 diff 格式，这种格式的具体规范在[这里](https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Unified.html)，本身也没多少内容.

这里比较重要的是，出现：

```diff
@@ from-file-line-numbers to-file-line-numbers @@
 line-from-either-file
 line-from-either-file...

```

可能还会出现 `‘start,count` 的表示方法，from 表示被修改的文件，to 表示被应用的文件 `start,count` 一般也会出现两次，都表示对 start 行进行修改，改动的范围是从 start 开始的 count 行。

每有一行 `@@ from-file-line-numbers to-file-line-numbers @@` 都代表着一次改动，称之为一个 chunk。chunk 内部描述的都是对文件的改动，注意所有的改动前面都需要有一个空格，即使一行是空行，也需要一个空格加一个 EOL。不然格式不规范。

还有就是由于不同操作系统的 EOL 不一样，不同操作系统之间的 patch 不能直接应用，还需要进行相关的转换改动。