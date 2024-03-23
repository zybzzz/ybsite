# port.hh

总共有两个 `port.hh` 文件，一个在 sim 目录下，一个在 mem 目录下，sim 目录下的只是对 `port` 的简单定义，而 mem 下的是对 `port` 的拓展。首先的拓展是为 `Packet` 定义了一个拓展类，使其能够记录 `Packet` 的传输过程。然后进行 `port` 功能的详细定义。

gem5 中主要需要去实现三种通信模式供 `port` 通信，因此 gem5 分别将这三种模式的接口拆分到 `mem/protocal` 目录下，并在 `port` 中继承这几个接口并对其做实现，但实际上这里的 `port` 也还没对这些接口实现完全。这个文件中的 `port` 更多的还是继续提供接口，具体的 `port` 实现还得到各个组件中去看，比如说 cpu 或者内存中去看。

然后就是 `RequestPort` 和 `ResponsePort` 的实现是几乎对称的，一端请求的发出会调用另一端的响应方法，以此来实现通信。以 `Timing` 模式为例，请求在发出之后会立即返回，但是响应则是需要等到几个内存读取的时间后才取得。