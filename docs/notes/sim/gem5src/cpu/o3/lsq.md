# load store queue

load store queue 封装在 `lsq.hh/cc` 中，里面的 LSQ 实现了 load store queue 的功能，但是实际上 LSQ 只是实现对 port 的定义还有一系列请求的封装，然后对外提供了 load store queue 的接口。实际上 load store queue 的具体实现都实现在 LSQUnit 中， LSQ 实际上只是对 LSQUnit 进行了一层上层的封装。
